---
name: search
description: Search the web for information using Exa
argument-hint: [query]
allowed-tools: bash, exa
---

## Instructions

Search the web for information about: $ARGUMENTS

Use the `connect-exa` CLI to perform the search:

```bash
connect-exa search "$ARGUMENTS" --max 5
```

Summarize the results in a clear, concise format with:
1. Key findings
2. Relevant links
3. Any important caveats

If no results are found, suggest alternative search queries.
