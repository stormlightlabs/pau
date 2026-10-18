# 2. Desktop app: Pi resources

## Pi resources

### 2.34 Resource browser

Status: planned
Blocked by: none

Build the Skills, Extensions, Prompts, Themes, and Packages views with source,
scope, trust, validation, and selected-resource detail.

Verification:

- Component-test empty, loading, invalid, untrusted, and mixed-scope states.

### 2.129 Resource filtering

Status: planned
Blocked by: 2.34

Filter the resource views by name, scope, and trust.

Verification:

- Verify filtering and keyboard navigation against a large fixture index.

### 2.35 Resource file editing API

Status: planned
Blocked by: none

Create and edit skill and prompt files through file-preserving operations, then
ask Pi to reload resources.

Verification:

- Create a valid resource, reject invalid metadata, preserve supporting files,
  and report reload errors.

### 2.130 Skill editor

Status: planned
Blocked by: 2.34, 2.35

Create and edit skills from the resource browser.

Verification:

- Component-test valid, invalid, and reload-failed states without losing edits.

### 2.131 Prompt editor

Status: planned
Blocked by: 2.130

Create and edit prompt templates from the resource browser.

Verification:

- Component-test valid, invalid, and reload-failed states without losing edits.

### 2.36 Package installation

Status: planned
Blocked by: 2.54

Install Pi packages through Pi's supported commands or APIs. Record each
installation in the mutation audit.

Verification:

- Exercise npm, Git, and local fixture packages in user and project scope.
- Cover trust denial, command failure, and partial installation with recovery
  guidance.

### 2.132 Package installation view

Status: planned
Blocked by: 2.34, 2.36

Let the operator install a package after showing its source and scope.

Verification:

- Component-test the confirmation, trust denial, and failure states.

### 2.133 Package updates

Status: planned
Blocked by: 2.36

Update installed Pi packages through Pi's supported commands or APIs. Record
each update in the mutation audit.

Verification:

- Cover npm, Git, and local fixture updates and a failed update with recovery
  guidance.

### 2.134 Package update view

Status: planned
Blocked by: 2.132, 2.133

Show available updates and let the operator apply one after showing its source
and scope.

Verification:

- Component-test up-to-date, update-available, and failed states.

### 2.135 Package removal

Status: planned
Blocked by: 2.36

Remove Pi packages through Pi's supported commands or APIs. Record each removal
in the mutation audit.

Verification:

- Cover removal in user and project scope and a failed removal with recovery
  guidance.

### 2.136 Package removal view

Status: planned
Blocked by: 2.132, 2.135

Let the operator remove a package after showing its source and scope.

Verification:

- Component-test the confirmation and failure states.

### 2.137 Package enablement

Status: planned
Blocked by: 2.36

Enable, disable, and filter a package's resources through Pi's supported
commands or APIs. Record each change in the mutation audit.

Verification:

- Cover enabling, disabling, and filtering in user and project scope.

### 2.138 Package enablement view

Status: planned
Blocked by: 2.132, 2.137

Let the operator enable, disable, and filter a package's resources.

Verification:

- Component-test enabled, disabled, and filtered packages.
