# Signed macOS builds

This guide produces a signed, notarized Pau release from a tag and installs it
at `/Applications/Pau.app`. You need an Apple Developer Program membership and a
Mac with Xcode or the Xcode command line tools.

Steps 1 to 3 happen once. Repeat steps 4 and 5 for each release tag.

## 1. Create a Developer ID Application certificate

Gatekeeper accepts apps from outside the App Store only when they are signed
with a **Developer ID Application** certificate. An "Apple Development"
certificate is for local testing and will not pass.

Only the team's Account Holder can create a Developer ID certificate, unless
the Account Holder has granted that permission to an Admin.

1. Open Xcode, then **Settings → Accounts**, and select your Apple ID.
2. Select the team, then **Manage Certificates**.
3. Click **+** and choose **Developer ID Application**.

Xcode creates the private key in your login keychain and installs the
certificate. To do this without Xcode, create a certificate signing request in
**Keychain Access → Certificate Assistant → Request a Certificate From a
Certificate Authority**, upload it at
<https://developer.apple.com/account/resources/certificates/add>, choose
**Developer ID Application**, and open the downloaded `.cer` file.

Confirm the identity is usable:

```sh
security find-identity -v -p codesigning
```

The output should include a line like this:

```text
1) 4F3A… "Developer ID Application: Your Name (TEAMID1234)"
```

The quoted text is your signing identity. The value in parentheses is your
team ID.

Export the certificate and its private key to a `.p12` file somewhere safe. If
the Mac is lost, the key cannot be downloaded again.

## 2. Create notarization credentials

Apple must notarize the app before Gatekeeper accepts it. The release script
supports two kinds of credentials. Use an App Store Connect API key unless you
have a reason not to. It does not depend on your Apple ID password or two-factor
prompts.

### App Store Connect API key

1. Go to <https://appstoreconnect.apple.com/access/integrations/api>.
2. Under **Team Keys**, generate a key with the **Developer** role.
3. Download the `.p8` file. Apple lets you download it only once.
4. Note the **Key ID** shown beside the key and the **Issuer ID** at the top of
   the page.

Store the key outside the repository and restrict it to your user, for example:

```sh
mkdir -p ~/.private-keys
mv ~/Downloads/AuthKey_<KEY_ID>.p8 ~/.private-keys/
chmod 600 ~/.private-keys/AuthKey_<KEY_ID>.p8
```

### Apple ID alternative

1. Create an app-specific password at <https://account.apple.com> under
   **Sign-In and Security → App-Specific Passwords**.
2. Use your Apple ID email, that password, and the team ID from step 1.

## 3. Save the credentials in `.env`

The release script reads the repository's `.env` file, which Git ignores.
Variables already set in your shell take precedence. If you have not created it
yet, start from the example:

```sh
cp .env.example .env
```

Fill in one credential set:

```sh
APPLE_SIGNING_IDENTITY="Developer ID Application: Your Name (TEAMID1234)"

# App Store Connect API key
APPLE_API_KEY=<KEY_ID>
APPLE_API_ISSUER=<ISSUER_ID>
APPLE_API_KEY_PATH=/Users/<you>/.private-keys/AuthKey_<KEY_ID>.p8

# Or the Apple ID alternative instead of the three lines above
# APPLE_ID=you@example.com
# APPLE_PASSWORD=<app-specific password>
# APPLE_TEAM_ID=TEAMID1234
```

On a Mac without the identity in its keychain, such as a CI runner, also set
`APPLE_CERTIFICATE` to the base64 of the `.p12` export and
`APPLE_CERTIFICATE_PASSWORD` to its password. The build imports it into a
temporary keychain and deletes that keychain when signing ends.

## 4. Build and install a release

From your checkout, run the install script. It lists recent release tags and
asks which one to build, or takes the version as an argument:

```sh
sh scripts/install.sh          # pick from recent tags
sh scripts/install.sh 0.8.0    # or name the version
```

It fetches tags, builds the chosen tag in a temporary worktree with its own
`target/`, copies your `.env` into it, and removes the worktree when it
finishes. Your checkout can have uncommitted changes and stays on its branch.
The first build takes a few minutes. Use `v0.6.0` or later.

`pnpm release:macos`, which the install script runs, then:

1. Builds the Apple Silicon app with the release identity
   (`org.stormlightlabs.pau`, product name "Pau"). The app carries the sandbox
   extension and its production dependencies in `Contents/Resources/sandbox`,
   because the installed app has no checkout to load them from.
2. Signs the native files among those dependencies, then the app, with your
   Developer ID and the hardened runtime.
3. Submits it to Apple for notarization and waits. The first submission can
   take from a few minutes to an hour. Later ones are usually quicker.
4. Staples the notarization ticket and checks the result with `codesign` and
   `spctl`.
5. Replaces `/Applications/Pau.app` only after every check passes, so a failed
   build leaves the installed copy alone.

It finishes with a line like `Installed Pau 0.8.0 at /Applications/Pau.app`.

Add `--unsigned` to build the same bundle without Apple credentials. It is
copied to `target/release-macos/` and never installed in `/Applications`,
because Gatekeeper rejects an unsigned app there.

## 5. Check the installed app

The release script already ran this check, but you can repeat it at any time:

```sh
spctl --assess --type execute -vv /Applications/Pau.app
```

`spctl` asks Gatekeeper whether it would open the app. The output should
include `accepted` and `source=Notarized Developer ID`. Then open Pau and
confirm that the Diagnostics view reports the tag's version without a `-dev`
suffix.

The release build keeps its data in `~/Library/Application Support/pau/`.
Development builds are named "Pau Dev" and use `pau-dev/`, so they never touch
the release database.

## Troubleshooting

- **`signing and notarization need these environment variables`.** `.env` is
  missing at the repository root, or one credential set is incomplete.
- **`Gatekeeper only accepts apps signed with a "Developer ID Application"
identity`.** `APPLE_SIGNING_IDENTITY` names an Apple Development certificate.
  Copy the Developer ID line from step 1 instead.
- **`the working tree has uncommitted changes`.** You ran `pnpm release:macos`
  directly in a checkout with local changes. Use the install script, or commit
  or stash the changes first. If `pnpm install` changed the lockfile, the tag
  and its lockfile disagree. Report that rather than committing on the tag.
- **The version or tag check fails.** `HEAD` is not at the tag for the
  `Cargo.toml` version. Check with `git describe --tags --exact-match`.
- **A sandboxed Pi session reports that Pau cannot find its sandbox
  extension.** The app was built without the release configuration. Build it
  with the install script or `pnpm release:macos`, not `tauri build`.
- **`errSecInternalComponent` while signing.** The login keychain is locked or
  asked for access in a dialog you could not see. Run
  `security unlock-keychain ~/Library/Keychains/login.keychain-db` and try
  again, then choose **Always Allow** if macOS asks.
- **Notarization is rejected.** Read Apple's log for the submission ID that the
  build printed:

  ```sh
  xcrun notarytool log <submission-id> \
    --key "$APPLE_API_KEY_PATH" --key-id "$APPLE_API_KEY" --issuer "$APPLE_API_ISSUER"
  ```

- **Pau shows "Pau could not start".** The dialog gives the reason. A database
  from a newer version means you installed an older release over a newer one.
  Install the newer tag again.
