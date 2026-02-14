---
name: research
description: Research a topic thoroughly using web search and multiple sources. Use when the user needs comprehensive information on a topic.
argument-hint: [topic]
allowed-tools: web_search, web_fetch, curl
---

## Instructions

Research the following topic: $ARGUMENTS

### Steps

1. Search the web for relevant information using web_search
2. Fetch the top 3-5 most relevant results using web_fetch
3. Cross-reference information from multiple sources
4. Synthesize findings into a comprehensive overview

### Output Format

- **Overview**: Brief introduction to the topic
- **Key Findings**: Main discoveries from research
- **Different Perspectives**: Any varying viewpoints found
- **Sources**: List the URLs used with brief descriptions
- **Recommendations**: Suggested next steps or additional resources

Be thorough but focused. Prioritize accuracy and cite sources.
