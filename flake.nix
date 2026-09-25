{
  description = "Pau development environment";

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
            alsa-lib
            at-spi2-atk
            at-spi2-core
            atk
            cairo
            cups
            dbus
            expat
            gdk-pixbuf
            glib
            gtk3
            harfbuzz
            libayatana-appindicator
            libdrm
            libgbm
            librsvg
            libsoup_3
            libxkbcommon
            mesa
            nspr
            nss
            pango
            stdenv.cc.cc.lib
            udev
            webkitgtk_4_1
            libx11
            libxcomposite
            libxdamage
            libxext
            libxfixes
            libxrandr
            libxcb
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
              lychee
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
              ${pkgs.lib.optionalString pkgs.stdenv.hostPlatform.isLinux ''
                export LD_LIBRARY_PATH="${pkgs.lib.makeLibraryPath linuxPackages}''${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
              ''}
              echo "Pau shell: Rust $(rustc --version | cut -d' ' -f2), Node $(node --version), pnpm $(pnpm --version)"
            '';
          };
        }
      );
    };
}
