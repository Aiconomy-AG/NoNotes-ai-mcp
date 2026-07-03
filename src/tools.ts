import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { NotesConfig } from "./config.js";
import { apiRequest, formatApiError, errorResult } from "./api-client.js";
import { CHARACTER_LIMIT } from "./constants.js";

const paragraphSchema = z.object({
  type: z.literal("paragraph"),
  text: z.string().describe("Plain text content of the paragraph."),
});

const listSchema = z.object({
  type: z.literal("list"),
  items: z.array(z.string()).describe("The bullet items, one string each."),
});

const blockSchema = z.discriminatedUnion("type", [paragraphSchema, listSchema]);
type Block = z.infer<typeof blockSchema>;

interface Note {
  id: number;
  title: string;
  blocks: Block[] | null;
  folder_id: number | null;
  created_at?: string;
  updated_at?: string;
}

interface Folder {
  id: number;
  name: string;
  parent_id: number | null;
  sort_order?: number;
  created_at?: string;
  updated_at?: string;
}

let blockCounter = 0;
function newBlockId(): string {
  blockCounter += 1;
  return `b${Date.now()}${blockCounter}`;
}

function withIds(blocks: Block[]): Array<Block & { id: string }> {
  return blocks.map((b) => ({ id: newBlockId(), ...b }));
}

function blocksToText(blocks: Block[] | null): string {
  if (!blocks) return "";
  return blocks
    .map((b) => (b.type === "paragraph" ? b.text : b.items.map((i) => `• ${i}`).join("\n")))
    .join("\n");
}

function summarize(note: Note) {
  const preview = blocksToText(note.blocks).replace(/\s+/g, " ").slice(0, 120);
  return { id: note.id, title: note.title, folder_id: note.folder_id, updated_at: note.updated_at, preview };
}

function jsonResult(data: unknown) {
  let text = JSON.stringify(data, null, 2);
  if (text.length > CHARACTER_LIMIT) {
    text = text.slice(0, CHARACTER_LIMIT) + "\n… (truncated)";
  }
  return { content: [{ type: "text" as const, text }] };
}


export function registerNoteTools(server: McpServer, config: NotesConfig): void {
  server.registerTool(
    "list_folders",
    {
      title: "List folders",
      description:
        "List all folders available to the user. Folders are nested by parent_id; " +
        "root folders have parent_id null. Use folder ids when creating or moving notes.",
      inputSchema: {},
    },
    async () => {
      try {
        const folders = await apiRequest<Folder[]>("api/folders", {}, config);
        return jsonResult({ count: folders.length, folders });
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "create_folder",
    {
      title: "Create a folder",
      description: "Create a folder or nested subfolder for organizing notes.",
      inputSchema: {
        name: z.string().optional().describe("Folder name. Defaults to 'Untitled folder'."),
        parent_id: z.number().int().nullable().optional().describe("Parent folder id, or null/root if omitted."),
      },
    },
    async ({ name, parent_id }) => {
      try {
        const created = await apiRequest<Folder>(
          "api/folders",
          { method: "POST", body: { name: name ?? "Untitled folder", parent_id: parent_id ?? null } },
          config,
        );
        return jsonResult(created);
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "update_folder",
    {
      title: "Update a folder",
      description:
        "Rename a folder and/or move it under another folder. Set parent_id to null to move it to root.",
      inputSchema: {
        id: z.number().int().describe("Folder id."),
        name: z.string().optional().describe("New folder name."),
        parent_id: z.number().int().nullable().optional().describe("New parent folder id, or null for root."),
      },
    },
    async ({ id, name, parent_id }) => {
      try {
        const body: Record<string, unknown> = {};
        if (name !== undefined) body.name = name;
        if (parent_id !== undefined) body.parent_id = parent_id;
        if (Object.keys(body).length === 0) {
          return errorResult("Nothing to update: provide `name` and/or `parent_id`.");
        }
        const updated = await apiRequest<Folder>(`api/folders/${id}`, { method: "PUT", body }, config);
        return jsonResult(updated);
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "delete_folder",
    {
      title: "Delete a folder",
      description:
        "Delete a folder by id. Notes and subfolders inside it are moved to root by the backend foreign-key behavior.",
      inputSchema: {
        id: z.number().int().describe("Folder id."),
      },
    },
    async ({ id }) => {
      try {
        await apiRequest(`api/folders/${id}`, { method: "DELETE" }, config);
        return { content: [{ type: "text" as const, text: `Deleted folder ${id}.` }] };
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "list_notes",
    {
      title: "List notes",
      description:
        "List all of the user's notes (most recent first) as compact summaries " +
        "with id, title, last-updated time and a short text preview. " +
        "Use get_note to read a note's full content.",
      inputSchema: {},
    },
    async () => {
      try {
        const notes = await apiRequest<Note[]>("api/notes", {}, config);
        return jsonResult({ count: notes.length, notes: notes.map(summarize) });
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "get_note",
    {
      title: "Get a note",
      description: "Get one note by id, including its full block content (paragraphs and lists).",
      inputSchema: {
        id: z.number().int().describe("The note id."),
      },
    },
    async ({ id }) => {
      try {
        const notes = await apiRequest<Note[]>("api/notes", {}, config);
        const note = notes.find((n) => n.id === id);
        if (!note) return errorResult(`Note ${id} not found.`);
        return jsonResult(note);
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "search_notes",
    {
      title: "Search notes",
      description:
        "Search the user's notes by a text query. Matches against the title and " +
        "the text content of paragraphs and list items (case-insensitive). " +
        "Returns compact summaries.",
      inputSchema: {
        query: z.string().min(1).describe("Text to search for in titles and content."),
      },
    },
    async ({ query }) => {
      try {
        const notes = await apiRequest<Note[]>("api/notes", {}, config);
        const q = query.toLowerCase();
        const matches = notes.filter(
          (n) =>
            n.title.toLowerCase().includes(q) || blocksToText(n.blocks).toLowerCase().includes(q),
        );
        return jsonResult({ query, count: matches.length, notes: matches.map(summarize) });
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "create_note",
    {
      title: "Create a note",
      description:
        "Create a new note. Provide `blocks` for structured content (paragraphs and/or " +
        "bullet lists), or `text` as a shortcut to create a single paragraph. " +
        "If neither is given, an empty note is created.",
      inputSchema: {
        title: z.string().optional().describe("Note title. Defaults to 'Untitled'."),
        folder_id: z.number().int().nullable().optional().describe("Folder id to place the note in, or null/root."),
        blocks: z
          .array(blockSchema)
          .optional()
          .describe(
            "Ordered content blocks. Each is either " +
              '{ "type": "paragraph", "text": "..." } or ' +
              '{ "type": "list", "items": ["...", "..."] }.',
          ),
        text: z.string().optional().describe("Shortcut: content as a single paragraph. Ignored if `blocks` is given."),
      },
    },
    async ({ title, folder_id, blocks, text }) => {
      try {
        const resolved: Block[] =
          blocks && blocks.length > 0
            ? blocks
            : text !== undefined
              ? [{ type: "paragraph", text }]
              : [{ type: "paragraph", text: "" }];

        const created = await apiRequest<Note>(
          "api/notes",
          { method: "POST", body: { title: title ?? "Untitled", folder_id: folder_id ?? null, blocks: withIds(resolved) } },
          config,
        );
        return jsonResult(created);
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "update_note",
    {
      title: "Update a note",
      description:
        "Update a note's title and/or blocks. `blocks` REPLACES the entire content " +
        "to edit, first read the note with get_note, modify the array, then send it back. " +
        "Omit a field to leave it unchanged.",
      inputSchema: {
        id: z.number().int().describe("The note id to update."),
        title: z.string().optional().describe("New title."),
        folder_id: z
          .number()
          .int()
          .nullable()
          .optional()
          .describe("Move note to this folder id. Use null to move it to root."),
        blocks: z
          .array(blockSchema)
          .optional()
          .describe("Full replacement content blocks (paragraph/list). Omit to keep existing."),
      },
    },
    async ({ id, title, folder_id, blocks }) => {
      try {
        const body: Record<string, unknown> = {};
        if (title !== undefined) body.title = title;
        if (folder_id !== undefined) body.folder_id = folder_id;
        if (blocks !== undefined) body.blocks = withIds(blocks);
        if (Object.keys(body).length === 0) {
          return errorResult("Nothing to update: provide `title` and/or `blocks`.");
        }
        const updated = await apiRequest<Note>(`api/notes/${id}`, { method: "PUT", body }, config);
        return jsonResult(updated);
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );

  server.registerTool(
    "delete_note",
    {
      title: "Delete a note",
      description: "Permanently delete a note by id.",
      inputSchema: {
        id: z.number().int().describe("The note id to delete."),
      },
    },
    async ({ id }) => {
      try {
        await apiRequest(`api/notes/${id}`, { method: "DELETE" }, config);
        return { content: [{ type: "text" as const, text: `Deleted note ${id}.` }] };
      } catch (err) {
        return errorResult(formatApiError(err));
      }
    },
  );
}
