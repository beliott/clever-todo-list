require("dotenv").config();

const express = require("express");

const app = express();
app.use(express.json());

app.use((req, res, next) => {
  const start = Date.now();
  res.on("finish", () => {
    console.log(`${req.method} ${req.path} ${res.statusCode} ${Date.now() - start}ms`);
  });
  next();
});

const PORT = process.env.PORT || 3000;
const APP_VERSION = process.env.APP_VERSION || "1.0.0";
const APP_NAME = process.env.APP_NAME || "MonAppLocale";
const DATABASE_URL = process.env.POSTGRESQL_ADDON_URI;

// -------------------------------------------------------------------
// Storage — PostgreSQL si défini, mémoire sinon
// -------------------------------------------------------------------

let storage;

// Helper to normalize and validate dates
const parseDate = (dateStr) => {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  console.log(d)
  return isNaN(d.getTime()) ? null : d.toISOString();
};

if (DATABASE_URL) {
  const { Pool } = require("pg");
  const pool = new Pool({ connectionString: DATABASE_URL });

  storage = {
    async init() {
      // Utilisation de SERIAL pour Postgres (AUTO_INCREMENT = MySQL)
      // Utilisation de VARCHAR + CHECK pour le statut (évite les erreurs de type ENUM déjà existant)
      await pool.query(`
        CREATE TABLE IF NOT EXISTS todos (
          id          SERIAL PRIMARY KEY,
          title       TEXT NOT NULL,
          description TEXT,
          due_date    DATE,
          status      VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'done')),
          created_at  TIMESTAMPTZ DEFAULT NOW()
        )
      `);
    },
    async healthCheck() {
      await pool.query("SELECT 1");
      return "connected";
    },
    async findAll() {
      const result = await pool.query("SELECT * FROM todos ORDER BY created_at DESC");
      return result.rows;
    },
    async find_with_status(status) {
      const result = await pool.query(
        "SELECT * FROM todos WHERE status = $1 ORDER BY created_at DESC",
        [status]
      );
      return result.rows;
    },
    async findById(id) {
      const result = await pool.query("SELECT * FROM todos WHERE id = $1", [id]);
      return result.rows[0];
    },
    async findOverdue() {
      const result = await pool.query(
        "SELECT * FROM todos WHERE status = 'pending' AND due_date < NOW() ORDER BY created_at DESC"
      );
      return result.rows;
    },
    async insert(title, description, due_date = null) {
      const normalizedDate = parseDate(due_date);
      const result = await pool.query(
        "INSERT INTO todos (title, description, due_date) VALUES ($1, $2, $3) RETURNING *",
        [title, description ?? null, normalizedDate]
      );
      return result.rows[0];
    },
    async update(id, updates) {
      const fields = [];
      const values = [];
      let idx = 1;
      
      for (const [key, val] of Object.entries(updates)) {
        if (['title', 'description', 'due_date', 'status'].includes(key)) {
          fields.push(`${key} = $${idx++}`);
          values.push(val);
        }
      }
      
      if (fields.length === 0) return await this.findById(id);
      
      values.push(id);
      const result = await pool.query(
        `UPDATE todos SET ${fields.join(", ")} WHERE id = $${idx} RETURNING *`,
        values
      );
      return result.rows[0];
    },
    async remove(id) {
      const result = await pool.query("DELETE FROM todos WHERE id = $1 RETURNING id", [id]);
      return result.rowCount > 0;
    }
  };
} else {
  console.warn("POSTGRESQL_ADDON_URI non défini — stockage en mémoire (données perdues au redémarrage)");

  let items = [];
  let nextId = 1;


  storage = {
    async init() {},
    async healthCheck() { return "not configured"; },
    async findAll() { return [...items].reverse(); },
    async find_with_status(status) { 
      return [...items].filter((e) => e.status === status).reverse();
    },
    async findById(id) {
      return items.find((e) => e.id === Number(id));
    },
    async findOverdue() {
      const now = new Date();
      return [...items].filter((e) => e.status === "pending" && e.due_date && new Date(e.due_date) < now).reverse();
    },
    async insert(title, description, due_date) {
      const item = {
        id: nextId++,
        title,
        description: description ?? null,
        due_date: parseDate(due_date), // Safe ISO string or null
        status: "pending",
        created_at: new Date().toISOString(),
      };
      items.push(item);
      return item;
    },
    async update(id, updates) {
      const index = items.findIndex((e) => e.id === Number(id));
      if (index === -1) return null;
      
      const item = items[index];
      ['title', 'description', 'due_date', 'status'].forEach((key) => {
        if (updates[key] !== undefined) item[key] = updates[key];
      });
      return item;
    },
    async remove(id) {
      const index = items.findIndex((e) => e.id === Number(id));
      if (index === -1) return false;
      items.splice(index, 1);
      return true;
    }
  };
}

// -------------------------------------------------------------------
// Routes
// -------------------------------------------------------------------

app.get("/", async (req, res) => {
  res.json({ message: `Bienvenue sur ${APP_NAME} (version ${APP_VERSION})` });
});

// GET /health
app.get("/health", async (req, res) => {
  const health = { status: "ok", app: APP_NAME };

  if (DATABASE_URL) {
    try {
      await storage.healthCheck();
      health.database = "connected";
    } catch {
      return res.status(503).json({ status: "error", app: APP_NAME, database: "unreachable" });
    }
  } else {
      health.database = "in-memory";
  }

  res.json(health);
});

// GET /todos/overdue (Doit être placée avant /todos/:id)
app.get("/todos/overdue", async (req, res) => {
  const items = await storage.findOverdue();
  res.json(items);
});

// GET /todos
app.get("/todos", async (req, res) => {
  let query = req.query;
  let items;
  if (query.status) {
    items = await storage.find_with_status(query.status);
  } else {
    items = await storage.findAll();
  }  
  res.json(items);
});

// POST /todos
app.post("/todos", async (req, res) => {
  const title = req.body.title;
  const description = req.body.description;
  const due_date = req.body.due_date;
  
  if (!title || title.trim() === "") {
    return res.status(400).json({ error: "Le champ 'title' est obligatoire et ne peut pas être vide" });
  }

  const todo = await storage.insert(title.trim(), description, due_date);
  res.status(201).json(todo);
});

// PATCH /todos/:id
app.patch("/todos/:id", async (req, res) => {
  const id = req.params.id;
  const existing = await storage.findById(id);
  
  if (!existing) {
    return res.status(404).json({ error: "Tâche non trouvée" });
  }

  const updatedTodo = await storage.update(id, req.body);
  res.json(updatedTodo);
});

// DELETE /todos/:id
app.delete("/todos/:id", async (req, res) => {
  const id = req.params.id;
  const existing = await storage.findById(id);
  
  if (!existing) {
    return res.status(404).json({ error: "Tâche non trouvée" });
  }

  await storage.remove(id);
  res.status(204).send();
});
// -------------------------------------------------------------------
// Server-Sent Events (SSE) : /alerts & /todos/:id/notify
// -------------------------------------------------------------------

const sseClients = new Set();

// GET /alerts
app.get("/alerts", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders(); // Établit la connexion immédiatement

  sseClients.add(res);

  // Nettoyage lors de la déconnexion
  req.on("close", () => {
    sseClients.delete(res);
  });
});

// Ping régulier pour maintenir les connexions ouvertes
setInterval(() => {
  sseClients.forEach((client) => {
    client.write("event: ping\ndata: {}\n\n");
  });
}, 30000);

// POST /todos/:id/notify
app.post("/todos/:id/notify", async (req, res) => {
  const id = req.params.id;
  const todo = await storage.findById(id);
  
  if (!todo) {
    return res.status(404).json({ error: "Tâche non trouvée" });
  }

  const eventData = JSON.stringify({
    id: todo.id,
    title: todo.title,
    status: todo.status,
    due_date: todo.due_date
  });

  // Diffuser à tous les clients
  sseClients.forEach((client) => {
    client.write(`event: todo_alert\ndata: ${eventData}\n\n`);
  });

  res.json({ message: "Alerte envoyée", listeners: sseClients.size });
});

// -------------------------------------------------------------------
// Démo PaaS : Crash
// -------------------------------------------------------------------

// GET /crash — provoque un arrêt brutal du processus
app.get("/crash", (req, res) => {
  res.json({ message: "Crash imminent..." });
  setTimeout(() => process.exit(1), 100);
});

// -------------------------------------------------------------------
// Démarrage
// -------------------------------------------------------------------

storage.init()
  .then(() => {
    app.listen(PORT, () => {
      console.log(`App démarrée sur le port ${PORT} (version ${APP_VERSION})`);
      console.log(`Base de données : ${DATABASE_URL ? "PostgreSQL" : "mémoire"}`);
    });
  })
  .catch((err) => {
    console.error("Erreur d'initialisation :", err.message);
    process.exit(1);
  });