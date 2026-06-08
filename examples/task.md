# Task

We are designing the storage format for a small local-first CLI tool that records
multi-round debates between AI agents. Each debate has a task, several rounds, and
per-round contributions from each agent.

Question: should the canonical source of truth be **(A)** a set of Markdown files on
disk, or **(B)** a single SQLite database, or **(C)** something else?

Recommend one option and justify it for a local-first, git-friendly, inspectable,
single-developer tool. Be concrete about the trade-offs you are rejecting.
