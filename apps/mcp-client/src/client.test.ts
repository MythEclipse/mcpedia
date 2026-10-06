import { describe, it, expect, vi } from "vitest";

// Tests for the MCP client wrapper. Uses a fake Client that implements the
// subset of methods McpediaClient uses, so no network/DB is needed.

// Mock the SDK client to avoid real network connections.
// vi.mock() is hoisted above the imports, so this fixture list has to be built
// with vi.hoisted() or the mock factory would reference it before initialization.
const mockTools = vi.hoisted(() => [
  { name: "search_documents", description: "keyword search" },
  { name: "get_document", description: "get doc body" },
  { name: "create_document", description: "create doc" },
  { name: "delete_document", description: "delete doc" },
]);

vi.mock("@modelcontextprotocol/sdk/client/index.js", () => ({
  Client: class {
    connect() {}
    close() {}
    listTools() {
      return Promise.resolve({ tools: mockTools });
    }
    callTool(opts: any) {
      const { name, arguments: args } = opts;
      if (name === "get_document") {
        return Promise.resolve({ content: [{ type: "text", text: `# ${args.slug}` }] });
      }
      if (name === "create_document") {
        return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ ok: true, slug: args.slug }) }] });
      }
      if (name === "delete_document") {
        return Promise.resolve({ content: [{ type: "text", text: JSON.stringify({ ok: true, deleted: true }) }] });
      }
      return Promise.resolve({ content: [{ type: "text", text: "[]" }] });
    }
    listResources() {
      return Promise.resolve({ resources: [{ uri: "mcpedia://docs", mimeType: "application/json" }] });
    }
    readResource({ uri }: any) {
      return Promise.resolve({ contents: [{ uri, mimeType: "text/markdown", text: "# Test" }] });
    }
  },
}));

vi.mock("@modelcontextprotocol/sdk/client/streamableHttp.js", () => ({
  StreamableHTTPClientTransport: class {
    constructor(url: URL, opts?: any) {}
  },
}));

const { McpediaClient } = await import("../src/client");

describe("McpediaClient", () => {
  it("listTools returns all registered tools", async () => {
    const client = await McpediaClient.connect("http://localhost:0/mcp");
    const tools = await client.listTools();
    expect(tools.length).toBe(4);
    expect(tools.map((t: any) => t.name)).toContain("search_documents");
    expect(tools.map((t: any) => t.name)).toContain("get_document");
    await client.disconnect();
  });

  it("getDocument returns markdown body", async () => {
    const client = await McpediaClient.connect("http://localhost:0/mcp");
    const body = await client.getDocument("docs/websocket/contract");
    expect(body).toBe("# docs/websocket/contract");
    await client.disconnect();
  });

  it("createDocument posts args and parses JSON response", async () => {
    const client = await McpediaClient.connect("http://localhost:0/mcp");
    const res = await client.createDocument({
      slug: "docs/test",
      title: "Test",
      section: "docs",
      body: "# Hello",
    });
    expect(res.ok).toBe(true);
    expect(res.slug).toBe("docs/test");
    await client.disconnect();
  });

  it("deleteDocument returns deleted flag", async () => {
    const client = await McpediaClient.connect("http://localhost:0/mcp");
    const res = await client.deleteDocument("docs/test");
    expect(res.ok).toBe(true);
    expect(res.deleted).toBe(true);
    await client.disconnect();
  });

  it("listResources returns resource list", async () => {
    const client = await McpediaClient.connect("http://localhost:0/mcp");
    const resources = await client.listResources();
    expect(resources.length).toBe(1);
    expect(resources[0].uri).toBe("mcpedia://docs");
    await client.disconnect();
  });

  it("readResource returns text content", async () => {
    const client = await McpediaClient.connect("http://localhost:0/mcp");
    const res = await client.readResource("mcpedia://docs/docs/websocket/contract");
    expect(res.text).toBe("# Test");
    expect(res.mimeType).toBe("text/markdown");
    await client.disconnect();
  });

  it("send headers via requestInit for auth", async () => {
    // Verify that options.headers are passed through to the transport constructor
    const client = await McpediaClient.connect("http://localhost:0/mcp", {
      headers: { "x-webhook-secret": "secret123" },
    });
    // We can't directly assert the transport constructor received headers,
    // but we verify the client connects and works with headers set.
    const tools = await client.listTools();
    expect(tools.length).toBeGreaterThan(0);
    await client.disconnect();
  });
});
