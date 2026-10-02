//! Observes Linux sandbox denials without making authorization decisions.
//!
//! The sandbox still enforces every operation. This library only wraps libc
//! entry points, preserves their return values and `errno`, and appends compact
//! records to the file named by `PAU_SANDBOX_DENIAL_REPORT`.

#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(target_os = "linux")]
mod linux {
    use std::cell::Cell;
    use std::ffi::{CStr, OsStr, c_char, c_int};
    use std::fmt::Write as _;
    use std::mem::{self, MaybeUninit};
    use std::os::unix::ffi::OsStrExt;
    use std::ptr;

    const REPORT_ENV: &[u8] = b"PAU_SANDBOX_DENIAL_REPORT\0";
    const MAX_TARGET: usize = 4096;
    const MAX_REPORT_SIZE: libc::off_t = 1024 * 1024;

    thread_local! {
        /// Prevents symbol lookup and report writes from recursively reporting.
        static ACTIVE: Cell<bool> = const { Cell::new(false) };
    }

    fn denied(errno: c_int, connect: bool) -> bool {
        errno == libc::EACCES
            || errno == libc::EROFS
            || errno == libc::EPERM
            || (connect && errno == libc::ENETUNREACH)
    }

    fn errno() -> c_int {
        // SAFETY: libc provides one thread-local errno location per thread.
        unsafe { *libc::__errno_location() }
    }

    fn set_errno(value: c_int) {
        // SAFETY: libc provides one thread-local errno location per thread.
        unsafe { *libc::__errno_location() = value };
    }

    fn path_bytes(path: *const c_char) -> &'static [u8] {
        if path.is_null() {
            return b"(null)";
        }
        // SAFETY: libc path functions require a valid NUL-terminated pointer.
        unsafe { CStr::from_ptr(path).to_bytes() }
    }

    fn path_at(dirfd: c_int, path: *const c_char) -> Vec<u8> {
        let named = path_bytes(path);
        if named.starts_with(b"/") || named == b"(null)" {
            return named.to_vec();
        }
        let link = if dirfd == libc::AT_FDCWD {
            b"/proc/self/cwd\0".to_vec()
        } else {
            format!("/proc/self/fd/{dirfd}\0").into_bytes()
        };
        let mut directory = vec![0_u8; MAX_TARGET];
        // SAFETY: link is NUL-terminated and directory is writable.
        let length = unsafe {
            libc::syscall(
                libc::SYS_readlinkat,
                libc::AT_FDCWD,
                link.as_ptr(),
                directory.as_mut_ptr(),
                directory.len(),
            )
        };
        if length < 0 {
            return named.to_vec();
        }
        directory.truncate(length as usize);
        directory.push(b'/');
        directory.extend_from_slice(named);
        directory
    }

    fn operation(dirfd: c_int, path: *const c_char, flags: c_int) -> &'static str {
        if flags & (libc::O_WRONLY | libc::O_RDWR | libc::O_TRUNC | libc::O_APPEND) == 0 {
            return "read";
        }
        if flags & libc::O_CREAT == 0 {
            return "write";
        }
        let mut metadata = MaybeUninit::<libc::stat>::uninit();
        // SAFETY: metadata points to enough writable memory for newfstatat.
        let exists = unsafe {
            libc::syscall(libc::SYS_newfstatat, dirfd, path, metadata.as_mut_ptr(), 0) == 0
        };
        if exists { "write" } else { "create" }
    }

    fn escaped(target: &[u8]) -> String {
        let mut output = String::with_capacity(target.len().min(MAX_TARGET));
        for &byte in target.iter().take(MAX_TARGET) {
            match byte {
                b'\\' => output.push_str("\\\\"),
                b'\t' => output.push_str("\\t"),
                b'\n' => output.push_str("\\n"),
                b'\r' => output.push_str("\\r"),
                0x20..=0x7e => output.push(char::from(byte)),
                _ => {
                    let _ = write!(output, "\\x{byte:02x}");
                }
            }
        }
        output
    }

    fn report(operation: &str, kind: &str, target: &[u8]) {
        ACTIVE.with(|active| {
            if active.replace(true) {
                return;
            }
            // Build one record before opening the append-only report. A single
            // write keeps records from different descendants from interleaving.
            let record = format!("PAU1\t{operation}\t{kind}\t{}\n", escaped(target));
            // SAFETY: getenv returns a process-owned NUL-terminated value.
            let report_path = unsafe { libc::getenv(REPORT_ENV.as_ptr().cast()) };
            if !report_path.is_null() {
                // Raw syscalls avoid re-entering these preload wrappers.
                // SAFETY: pointers remain valid for each syscall's duration.
                let fd = unsafe {
                    libc::syscall(
                        libc::SYS_openat,
                        libc::AT_FDCWD,
                        report_path,
                        libc::O_WRONLY | libc::O_APPEND | libc::O_CLOEXEC,
                        0,
                    ) as c_int
                };
                if fd >= 0 {
                    let mut metadata = MaybeUninit::<libc::stat>::uninit();
                    // SAFETY: metadata points to enough writable memory for fstat.
                    let status =
                        unsafe { libc::syscall(libc::SYS_fstat, fd, metadata.as_mut_ptr()) };
                    // SAFETY: a successful fstat initialized metadata.
                    let below_limit =
                        status == 0 && unsafe { metadata.assume_init().st_size < MAX_REPORT_SIZE };
                    // SAFETY: record is initialized and fd refers to the report.
                    unsafe {
                        if below_limit {
                            libc::syscall(libc::SYS_write, fd, record.as_ptr(), record.len());
                        }
                        libc::syscall(libc::SYS_close, fd);
                    }
                }
            }
            active.set(false);
        });
    }

    unsafe fn wrapped_openat(
        dirfd: c_int,
        path: *const c_char,
        flags: c_int,
        mode: libc::mode_t,
    ) -> c_int {
        // Raw syscalls avoid resolving the libc symbol from inside its wrapper.
        // SAFETY: arguments have the Linux openat syscall ABI.
        let result = unsafe { libc::syscall(libc::SYS_openat, dirfd, path, flags, mode) as c_int };
        let error = errno();
        if result < 0 && denied(error, false) {
            report(operation(dirfd, path, flags), "file", &path_at(dirfd, path));
            set_errno(error);
        }
        result
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn open(path: *const c_char, flags: c_int, mode: libc::mode_t) -> c_int {
        // SAFETY: the arguments have the libc open ABI.
        unsafe { wrapped_openat(libc::AT_FDCWD, path, flags, mode) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn open64(
        path: *const c_char,
        flags: c_int,
        mode: libc::mode_t,
    ) -> c_int {
        // SAFETY: the arguments have the libc open64 ABI.
        unsafe { wrapped_openat(libc::AT_FDCWD, path, flags | libc::O_LARGEFILE, mode) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn openat(
        dirfd: c_int,
        path: *const c_char,
        flags: c_int,
        mode: libc::mode_t,
    ) -> c_int {
        // SAFETY: the arguments have the libc openat ABI.
        unsafe { wrapped_openat(dirfd, path, flags, mode) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn openat64(
        dirfd: c_int,
        path: *const c_char,
        flags: c_int,
        mode: libc::mode_t,
    ) -> c_int {
        // SAFETY: the arguments have the libc openat64 ABI.
        unsafe { wrapped_openat(dirfd, path, flags | libc::O_LARGEFILE, mode) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn creat(path: *const c_char, mode: libc::mode_t) -> c_int {
        // SAFETY: creat is open with these fixed flags.
        unsafe {
            wrapped_openat(
                libc::AT_FDCWD,
                path,
                libc::O_CREAT | libc::O_WRONLY | libc::O_TRUNC,
                mode,
            )
        }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn creat64(path: *const c_char, mode: libc::mode_t) -> c_int {
        // SAFETY: creat64 is open with these fixed flags.
        unsafe {
            wrapped_openat(
                libc::AT_FDCWD,
                path,
                libc::O_CREAT | libc::O_WRONLY | libc::O_TRUNC | libc::O_LARGEFILE,
                mode,
            )
        }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn rename(old: *const c_char, new: *const c_char) -> c_int {
        // SAFETY: arguments have the Linux renameat syscall ABI.
        unsafe { wrapped_renameat(libc::AT_FDCWD, old, libc::AT_FDCWD, new) }
    }

    unsafe fn wrapped_renameat(
        old_dirfd: c_int,
        old: *const c_char,
        new_dirfd: c_int,
        new: *const c_char,
    ) -> c_int {
        // SAFETY: arguments have the Linux renameat syscall ABI.
        let result =
            unsafe { libc::syscall(libc::SYS_renameat, old_dirfd, old, new_dirfd, new) as c_int };
        let error = errno();
        if result < 0 && denied(error, false) {
            report("rename", "file", &path_at(new_dirfd, new));
            set_errno(error);
        }
        result
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn renameat(
        old_dirfd: c_int,
        old: *const c_char,
        new_dirfd: c_int,
        new: *const c_char,
    ) -> c_int {
        // SAFETY: arguments have the libc renameat ABI.
        unsafe { wrapped_renameat(old_dirfd, old, new_dirfd, new) }
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn renameat2(
        old_dirfd: c_int,
        old: *const c_char,
        new_dirfd: c_int,
        new: *const c_char,
        flags: libc::c_uint,
    ) -> c_int {
        // SAFETY: arguments have the Linux renameat2 syscall ABI.
        let result = unsafe {
            libc::syscall(libc::SYS_renameat2, old_dirfd, old, new_dirfd, new, flags) as c_int
        };
        let error = errno();
        if result < 0 && denied(error, false) {
            report("rename", "file", &path_at(new_dirfd, new));
            set_errno(error);
        }
        result
    }

    fn socket_target(
        address: *const libc::sockaddr,
        length: libc::socklen_t,
    ) -> Option<(String, &'static str)> {
        if address.is_null() || usize::try_from(length).ok()? < mem::size_of::<libc::sa_family_t>()
        {
            return None;
        }
        // SAFETY: connect requires at least a sockaddr header at this pointer.
        let family = unsafe { (*address).sa_family as c_int };
        match family {
            libc::AF_UNIX => {
                if usize::try_from(length).ok()? < mem::size_of::<libc::sa_family_t>() + 1 {
                    return Some(("(unnamed)".into(), "unix"));
                }
                // SAFETY: family and supplied length identify sockaddr_un.
                let unix = unsafe { &*address.cast::<libc::sockaddr_un>() };
                let base = mem::offset_of!(libc::sockaddr_un, sun_path);
                let available = usize::try_from(length)
                    .ok()?
                    .saturating_sub(base)
                    .min(unix.sun_path.len());
                let bytes = unsafe {
                    std::slice::from_raw_parts(unix.sun_path.as_ptr().cast::<u8>(), available)
                };
                let (prefix, path) = if bytes.first() == Some(&0) {
                    ("@", &bytes[1..])
                } else {
                    ("", bytes)
                };
                let end = path
                    .iter()
                    .position(|byte| *byte == 0)
                    .unwrap_or(path.len());
                Some((
                    format!(
                        "{prefix}{}",
                        OsStr::from_bytes(&path[..end]).to_string_lossy()
                    ),
                    "unix",
                ))
            }
            libc::AF_INET
                if usize::try_from(length).ok()? >= mem::size_of::<libc::sockaddr_in>() =>
            {
                // SAFETY: family and supplied length identify sockaddr_in.
                let inet = unsafe { &*address.cast::<libc::sockaddr_in>() };
                let octets = inet.sin_addr.s_addr.to_ne_bytes();
                Some((
                    format!(
                        "{}.{}.{}.{}:{}",
                        octets[0],
                        octets[1],
                        octets[2],
                        octets[3],
                        u16::from_be(inet.sin_port)
                    ),
                    "tcp",
                ))
            }
            libc::AF_INET6
                if usize::try_from(length).ok()? >= mem::size_of::<libc::sockaddr_in6>() =>
            {
                // SAFETY: family and supplied length identify sockaddr_in6.
                let inet = unsafe { &*address.cast::<libc::sockaddr_in6>() };
                let segments = inet
                    .sin6_addr
                    .s6_addr
                    .chunks_exact(2)
                    .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
                    .collect::<Vec<_>>();
                Some((
                    format!(
                        "[{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}:{:x}]:{}",
                        segments[0],
                        segments[1],
                        segments[2],
                        segments[3],
                        segments[4],
                        segments[5],
                        segments[6],
                        segments[7],
                        u16::from_be(inet.sin6_port)
                    ),
                    "tcp",
                ))
            }
            _ => None,
        }
    }

    fn stream_socket(fd: c_int) -> bool {
        let mut kind: c_int = 0;
        let mut length = mem::size_of::<c_int>() as libc::socklen_t;
        // SAFETY: kind and length point to writable values of the requested size.
        let result = unsafe {
            libc::syscall(
                libc::SYS_getsockopt,
                fd,
                libc::SOL_SOCKET,
                libc::SO_TYPE,
                ptr::addr_of_mut!(kind),
                ptr::addr_of_mut!(length),
            )
        };
        result == 0 && kind & libc::SOCK_STREAM == libc::SOCK_STREAM
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn connect(
        socket: c_int,
        address: *const libc::sockaddr,
        length: libc::socklen_t,
    ) -> c_int {
        // Capture the destination before the syscall returns; callers may reuse it.
        let target = socket_target(address, length);
        // SAFETY: arguments have the Linux connect syscall ABI.
        let result = unsafe { libc::syscall(libc::SYS_connect, socket, address, length) as c_int };
        let error = errno();
        if result < 0 && denied(error, true) && stream_socket(socket) {
            if let Some((target, kind)) = target {
                report("connect", kind, target.as_bytes());
                set_errno(error);
            }
        }
        result
    }

    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn socket(domain: c_int, kind: c_int, protocol: c_int) -> c_int {
        // SAFETY: arguments have the Linux socket syscall ABI.
        let result = unsafe { libc::syscall(libc::SYS_socket, domain, kind, protocol) as c_int };
        let error = errno();
        if result < 0
            && denied(error, true)
            && domain == libc::AF_UNIX
            && kind & libc::SOCK_STREAM == libc::SOCK_STREAM
        {
            report("connect", "unix", b"(Unix socket)");
            set_errno(error);
        }
        result
    }
}

/// Keeps the crate buildable on development hosts where `LD_PRELOAD` does not
/// exist. Packaging includes this library only for Linux targets.
#[cfg(not(target_os = "linux"))]
#[unsafe(no_mangle)]
pub extern "C" fn pau_sandbox_denial_preload_is_linux_only() {}
