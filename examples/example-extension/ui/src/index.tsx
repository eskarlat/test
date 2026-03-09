import { useState, useEffect } from "react";
import type { ExtensionModule, ExtensionPageProps } from "@renre-kit/extension-sdk";

interface Item {
  id: number;
  title: string;
  description: string;
  created_at: string;
}

function ItemsPage({ apiBaseUrl }: ExtensionPageProps) {
  const [items, setItems] = useState<Item[]>([]);
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);

  const fetchItems = () => {
    setLoading(true);
    fetch(`${apiBaseUrl}/items`)
      .then((r) => r.json())
      .then((data: { items: Item[] }) => {
        setItems(data.items);
        setLoading(false);
      })
      .catch((err: Error) => {
        setError(err.message);
        setLoading(false);
      });
  };

  useEffect(() => {
    fetchItems();
  }, [apiBaseUrl]);

  const handleCreate = () => {
    if (!title.trim()) return;
    fetch(`${apiBaseUrl}/items`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, description }),
    })
      .then(() => {
        setTitle("");
        setDescription("");
        fetchItems();
      })
      .catch((err: Error) => setError(err.message));
  };

  const handleDelete = (id: number) => {
    fetch(`${apiBaseUrl}/items/${id}`, { method: "DELETE" })
      .then(() => fetchItems())
      .catch((err: Error) => setError(err.message));
  };

  if (loading) return <div style={{ padding: "1rem" }}>Loading...</div>;
  if (error) return <div style={{ padding: "1rem", color: "red" }}>Error: {error}</div>;

  return (
    <div style={{ padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>Items</h1>

      <div style={{ marginBottom: "1.5rem", display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Title"
          style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
        />
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Description"
          style={{ padding: "0.5rem", border: "1px solid #ccc", borderRadius: "4px" }}
        />
        <button
          onClick={handleCreate}
          style={{
            padding: "0.5rem 1rem",
            background: "#3b82f6",
            color: "#fff",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
          }}
        >
          Add
        </button>
      </div>

      {items.length === 0 ? (
        <p style={{ color: "#666" }}>No items yet. Create one above.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {items.map((item) => (
            <li
              key={item.id}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                padding: "0.75rem",
                border: "1px solid #e5e7eb",
                borderRadius: "6px",
                marginBottom: "0.5rem",
              }}
            >
              <div>
                <div style={{ fontWeight: 500 }}>{item.title}</div>
                {item.description && (
                  <div style={{ color: "#666", fontSize: "0.875rem" }}>{item.description}</div>
                )}
              </div>
              <button
                onClick={() => handleDelete(item.id)}
                style={{
                  padding: "0.25rem 0.75rem",
                  background: "#ef4444",
                  color: "#fff",
                  border: "none",
                  borderRadius: "4px",
                  cursor: "pointer",
                  fontSize: "0.875rem",
                }}
              >
                Delete
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function AboutPage({ extensionName }: ExtensionPageProps) {
  return (
    <div style={{ padding: "1rem", fontFamily: "system-ui, sans-serif" }}>
      <h1 style={{ fontSize: "1.5rem", marginBottom: "1rem" }}>About {extensionName}</h1>
      <p>This is a RenRe Kit example extension demonstrating:</p>
      <ul style={{ paddingLeft: "1.5rem", lineHeight: "1.8" }}>
        <li>Backend routes with Express Router</li>
        <li>SQLite database via ScopedDatabase proxy</li>
        <li>Database migrations</li>
        <li>Extension settings with Vault integration</li>
        <li>Dynamic UI pages loaded by the Console shell</li>
      </ul>
      <p style={{ marginTop: "1rem", color: "#666", fontSize: "0.875rem" }}>
        SDK version: 0.1.0 | Built with @renre-kit/extension-sdk
      </p>
    </div>
  );
}

const module: ExtensionModule = {
  pages: {
    items: ItemsPage,
    about: AboutPage,
  },
};

export default module;
