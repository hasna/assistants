---
name: email
description: Check and manage Gmail inbox
argument-hint: [inbox|unread|send "to" "subject" "body"]
allowed-tools: bash, gmail
---

## Instructions

Manage email based on the command: $ARGUMENTS

### Commands

**View inbox:**
```bash
connect-gmail messages list --max 10
```

**View unread:**
```bash
connect-gmail messages list --unread --max 10
```

**Send email:**
Parse the recipient, subject, and body from arguments:
```bash
connect-gmail messages send --to "recipient@example.com" --subject "Subject" --body "Body text"
```

**Search emails:**
```bash
connect-gmail messages search "query" --max 10
```

### Output Format

Present emails as:
- **From** | Subject | Date
  Preview of body (first 100 chars)

Flag important or urgent emails.
