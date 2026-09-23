{
  description = "Pi desktop orchestrator development environment";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

  outputs =
    { nixpkgs, ... }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
        "aarch64-darwin"
      ];
      forAllSystems = nixpkgs.lib.genAttrs systems;
    in
    {
      devShells = forAllSystems (
        system:
        let
          pkgs = import nixpkgs { inherit system; };
          linuxPackages = with pkgs; [
            atk
            cairo
            dbus
            gdk-pixbuf
            glib
            gtk3
            harfbuzz
            libayatana-appindicator
            librsvg
            libsoup_3
            pango
            webkitgtk_4_1
            zlib
          ];
          darwinPackages = with pkgs; [
            libiconv
          ];
        in
        {
          default = pkgs.mkShell {
            nativeBuildInputs = with pkgs; [
              cargo
              clippy
              file
              nodejs_24
              pkg-config
              pnpm
              rust-analyzer
              rustc
              rustfmt
            ];

            buildInputs = with pkgs; [
              neovim
              openssl
              sqlite
            ] ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isLinux linuxPackages
              ++ pkgs.lib.optionals pkgs.stdenv.hostPlatform.isDarwin darwinPackages;

            shellHook = ''
              echo "Pi orchestrator shell: Rust $(rustc --version | cut -d' ' -f2), Node $(node --version), pnpm $(pnpm --version)"
            '';
          };
        }
      );
    };
}
