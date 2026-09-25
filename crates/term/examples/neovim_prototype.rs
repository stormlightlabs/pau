//! Development-only Neovim RPC and line-grid prototype.
//!
//! This attaches to `nvim --embed`, edits a line through `nvim_input`, resizes
//! the external UI, and prints the resulting line grid.

use std::{error::Error, io, time::Duration};

use async_trait::async_trait;
use nvim_rs::{
    Handler, Neovim, Value, compat::tokio::Compat, create::tokio as create,
    uioptions::UiAttachOptions,
};
use tokio::{
    process::{ChildStdin, Command},
    sync::mpsc::{UnboundedReceiver, UnboundedSender, unbounded_channel},
    time::timeout,
};

const INITIAL_WIDTH: usize = 40;
const INITIAL_HEIGHT: usize = 8;
const RESIZED_WIDTH: usize = 52;
const RESIZED_HEIGHT: usize = 10;
const EXPECTED_LINE: &str = "changed in Pau";

#[derive(Clone)]
struct RedrawHandler {
    sender: UnboundedSender<Vec<Value>>,
}

#[async_trait]
impl Handler for RedrawHandler {
    type Writer = Compat<ChildStdin>;

    async fn handle_notify(&self, name: String, args: Vec<Value>, _neovim: Neovim<Self::Writer>) {
        if name == "redraw" {
            let _ = self.sender.send(args);
        }
    }
}

#[derive(Debug, Default)]
struct LineGrid {
    width: usize,
    height: usize,
    rows: Vec<Vec<String>>,
}

impl LineGrid {
    fn apply_redraw(&mut self, redraw: &[Value]) {
        for event in redraw {
            let Some(parts) = event.as_array() else {
                continue;
            };
            let Some(name) = parts.first().and_then(Value::as_str) else {
                continue;
            };

            for call in &parts[1..] {
                let Some(arguments) = call.as_array() else {
                    continue;
                };
                match name {
                    "grid_resize" => self.resize(arguments),
                    "grid_clear" => self.clear(arguments),
                    "grid_line" => self.write_line(arguments),
                    _ => {}
                }
            }
        }
    }

    fn resize(&mut self, arguments: &[Value]) {
        if grid_id(arguments) != Some(1) {
            return;
        }
        let (Some(width), Some(height)) = (
            arguments.get(1).and_then(value_as_usize),
            arguments.get(2).and_then(value_as_usize),
        ) else {
            return;
        };
        self.width = width;
        self.height = height;
        self.rows = vec![vec![" ".into(); width]; height];
    }

    fn clear(&mut self, arguments: &[Value]) {
        if grid_id(arguments) == Some(1) {
            for row in &mut self.rows {
                row.fill(" ".into());
            }
        }
    }

    fn write_line(&mut self, arguments: &[Value]) {
        if grid_id(arguments) != Some(1) {
            return;
        }
        let (Some(row), Some(mut column), Some(cells)) = (
            arguments.get(1).and_then(value_as_usize),
            arguments.get(2).and_then(value_as_usize),
            arguments.get(3).and_then(Value::as_array),
        ) else {
            return;
        };
        let Some(target) = self.rows.get_mut(row) else {
            return;
        };

        for cell in cells {
            let Some(cell) = cell.as_array() else {
                continue;
            };
            let Some(text) = cell.first().and_then(Value::as_str) else {
                continue;
            };
            let repeat = cell.get(2).and_then(value_as_usize).unwrap_or(1);
            for _ in 0..repeat {
                if let Some(slot) = target.get_mut(column) {
                    *slot = text.into();
                }
                column += 1;
            }
        }
    }

    fn rendered_rows(&self) -> impl Iterator<Item = String> + '_ {
        self.rows
            .iter()
            .map(|row| row.concat().trim_end().to_owned())
    }
}

fn grid_id(arguments: &[Value]) -> Option<i64> {
    arguments.first().and_then(Value::as_i64)
}

fn value_as_usize(value: &Value) -> Option<usize> {
    value.as_u64().and_then(|value| usize::try_from(value).ok())
}

async fn wait_for_render(
    receiver: &mut UnboundedReceiver<Vec<Value>>,
) -> Result<LineGrid, Box<dyn Error>> {
    timeout(Duration::from_secs(5), async {
        let mut grid = LineGrid::default();
        while let Some(redraw) = receiver.recv().await {
            grid.apply_redraw(&redraw);
            if grid.width == RESIZED_WIDTH
                && grid.height == RESIZED_HEIGHT
                && grid.rendered_rows().any(|line| line == EXPECTED_LINE)
            {
                return Ok(grid);
            }
        }
        Err(io::Error::new(
            io::ErrorKind::UnexpectedEof,
            "Neovim closed before drawing the changed line",
        ))
    })
    .await
    .map_err(|_| io::Error::new(io::ErrorKind::TimedOut, "timed out waiting for redraw"))?
    .map_err(Into::into)
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn Error>> {
    let (sender, mut receiver) = unbounded_channel();
    let handler = RedrawHandler { sender };
    let mut command = Command::new("nvim");
    command.args(["-u", "NONE", "-n", "--embed", "--headless"]);
    let (nvim, io_handle, mut child) = create::new_child_cmd(&mut command, handler).await?;

    let mut options = UiAttachOptions::new();
    options.set_linegrid_external(true).set_rgb(true);
    nvim.ui_attach(INITIAL_WIDTH as i64, INITIAL_HEIGHT as i64, &options)
        .await?;
    nvim.command("enew | call setline(1, 'replace me')").await?;
    nvim.input("ggccchanged in Pau<Esc>").await?;
    nvim.ui_try_resize(RESIZED_WIDTH as i64, RESIZED_HEIGHT as i64)
        .await?;

    let grid = wait_for_render(&mut receiver).await?;
    println!("rendered {}x{} line grid:", grid.width, grid.height);
    for line in grid.rendered_rows().filter(|line| !line.is_empty()) {
        println!("{line}");
    }

    let _ = nvim.quit_no_save().await;
    let _ = child.wait().await;
    let _ = io_handle.await;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn array(values: impl IntoIterator<Item = Value>) -> Value {
        Value::Array(values.into_iter().collect())
    }

    #[test]
    fn applies_line_grid_resize_and_repeated_cells() {
        let mut grid = LineGrid::default();
        let redraw = [
            array(["grid_resize".into(), array([1.into(), 8.into(), 2.into()])]),
            array([
                "grid_line".into(),
                array([
                    1.into(),
                    0.into(),
                    0.into(),
                    array([
                        array(["Pau".into(), 0.into()]),
                        array([" ".into(), 0.into(), 2.into()]),
                        array(["UI".into()]),
                    ]),
                    false.into(),
                ]),
            ]),
        ];

        grid.apply_redraw(&redraw);

        assert_eq!((grid.width, grid.height), (8, 2));
        assert_eq!(grid.rendered_rows().next().as_deref(), Some("Pau  UI"));
    }
}
