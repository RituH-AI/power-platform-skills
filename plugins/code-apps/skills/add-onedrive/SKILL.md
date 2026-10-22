---
name: add-onedrive
description: Adds OneDrive for Business connector to a Power Apps code app. Use when uploading, downloading, listing, or managing files in OneDrive.
user-invocable: true
allowed-tools: Read, Edit, Write, Grep, Glob, Bash, LSP, TaskCreate, TaskUpdate, TaskList, TaskGet, AskUserQuestion, Skill
model: sonnet
---

**📋 Shared Instructions: [shared-instructions.md](${PLUGIN_ROOT}/shared/shared-instructions.md)** - Cross-cutting concerns.

# Add OneDrive for Business

## Workflow

1. Check Memory Bank → 2. Add Connector → 3. Configure → 4. Build → 5. Update Memory Bank

---

### Step 1: Check Memory Bank

Check for `memory-bank.md` per [shared-instructions.md](${PLUGIN_ROOT}/shared/shared-instructions.md).

### Step 2: Add Connector

Get the connection as described in [connector-reference.md](${PLUGIN_ROOT}/shared/connector-reference.md#connections).

**CLI 1.3.0+ (`PA_INLINE_CONNECTIONS=yes`):** tell the user that adding OneDrive for Business may create a connection with their account, then run the add without `-c` and handle the result with the outcome table in connector-reference.md:

```bash
pa app add data-source --connector onedriveforbusiness --non-interactive
```

**Older CLIs:** run `/list-connections` to find the OneDrive for Business connection ID (if none exists, create one with `pa connection create` as described in connector-reference.md), then:

```bash
pa app add data-source --connector onedriveforbusiness -c <connection-id>
```

### Step 3: Configure

Ask the user what file operations they need (list files, upload, download, create folder, etc.).

**Common operations:**

```typescript
// List files in a folder
const files = await OneDriveForBusinessService.ListFolder({
  id: "root" // or folder ID
});

// Get file metadata
const metadata = await OneDriveForBusinessService.GetFileMetadata({
  id: "file-id"
});

// Get file content
const content = await OneDriveForBusinessService.GetFileContent({
  id: "file-id"
});

// Create file
await OneDriveForBusinessService.CreateFile({
  folderPath: "/Documents",
  name: "report.txt",
  body: "File content here"
});
```

**Key points:**

- File and folder IDs can be obtained from `ListFolder` or `ListRootFolder`
- Use `folderPath` for creating files by path, `id` for accessing existing files
- Binary file content may need base64 encoding/decoding depending on the operation

Use `Grep` to find specific methods in `src/generated/services/OneDriveForBusinessService.ts` (generated files can be very large -- see [connector-reference.md](${PLUGIN_ROOT}/shared/connector-reference.md#inspecting-large-generated-files)).

### Step 4: Build

```bash
npm run build
```

Fix TypeScript errors before proceeding. Do NOT deploy yet.

### Step 5: Update Memory Bank

Update `memory-bank.md` with: connector added, configured operations, build status.
