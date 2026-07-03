# NoNotes account connector to LLMs
## Functionalities:
- List your notes - see all of them at a glance (title, last updated, short preview)
- Search notes - find notes by keyword across titles and content
- Read a note in full - pull up the complete content of any note
- Create a note - new note with a title, plain paragraphs, and/or bullet lists
- Update a note - change the title and/or replace its content

Connection guide (for Claude):
1. Log into your claude account
2. Open settings -> Connectors -> Add -> Add custom connector
3. Name the connector antyhing you want (recommended: NoNotes)
4. Add the following MCP Server URL:
   ```
   https://nonotes-mcp.internship.aico.dev/mcp
   ```
6. Click Add
7. Click Connect button
8. Log in with your NoNotes account on the page you're redirected to
9. Give claude the permissions it needs when it's asking for them in chat
10. Enjoy!
