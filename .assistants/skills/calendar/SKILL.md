---
name: calendar
description: View and manage Google Calendar events
argument-hint: [today|tomorrow|week|add "event"]
allowed-tools: bash, googlecalendar
---

## Instructions

Manage calendar events based on the command: $ARGUMENTS

### Commands

**View today's events:**
```bash
connect-googlecalendar events list --today
```

**View tomorrow's events:**
```bash
connect-googlecalendar events list --tomorrow
```

**View this week's events:**
```bash
connect-googlecalendar events list --week
```

**Add an event:**
Parse the event details from the arguments and create the event:
```bash
connect-googlecalendar events create "Event Title" --start "2025-01-31T10:00:00" --end "2025-01-31T11:00:00"
```

### Output Format

Present events in a clean list:
- **Time** - Event Title (Location if available)

For conflicts or busy periods, highlight them.
