---
name: notes
description: Create and manage notes in Notion
argument-hint: [list|create "title"|search "query"]
allowed-tools: bash, notion
---

## Instructions

Manage notes in Notion based on the command: $ARGUMENTS

### Commands

**List recent notes:**
```bash
connect-notion pages list --max 10
```

**Create a note:**
Parse the title and optional content from arguments:
```bash
connect-notion pages create "PARENT_PAGE_ID" "Note Title" --content "Note content here"
```

Note: You'll need to know the parent page ID. List pages first to find it.

**Search notes:**
```bash
connect-notion search "query" --pages
```

**Get note content:**
```bash
connect-notion blocks children "PAGE_ID"
```

### Output Format

Present notes with:
- Title
- Last edited date
- Preview of content

For search results, show relevance highlights.
