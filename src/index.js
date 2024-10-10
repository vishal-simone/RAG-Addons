import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { methodOverride } from 'hono/method-override'

import notes from './notes.html'
import ui from './ui.html'
import write from './write.html'

const app = new Hono()
app.use(cors())

app.get('/notes.json', async (c) => {
  const query = `SELECT * FROM notes`
  const { results } = await c.env.DB.prepare(query).all()
  return c.json(results);
})

app.get('/notes', async (c) => {
	return c.html(notes);
})

app.use('/notes/:id', methodOverride({ app }))
app.delete('/notes/:id', async (c) => {
  const { id } = c.req.param();
  const query = `DELETE FROM notes WHERE id = ?`
  await c.env.DATABASE.prepare(query).bind(id).run()
	await c.env.VECTOR_INDEX.deleteByIds([id])
	return c.redirect('/notes')
})

app.post("/notes", async (c) => {
  const { text } = await c.req.json();
  if (!text) {
    return c.text("Missing text", 400);
  }

  // console.log(await c.env.DB.prepare("SELECT name FROM sqlite_master WHERE type='table'").run())

  // await c.env.DB.prepare(`
  //   CREATE TABLE IF NOT EXISTS notes (
  //     id INTEGER PRIMARY KEY AUTOINCREMENT,
  //     text TEXT NOT NULL
  //   )
  // `).run();
  const { results } = await c.env.DB.prepare(
    "INSERT INTO notes (text) VALUES (?) RETURNING *",
  )
    .bind(text)
    .run();

  const record = results.length ? results[0] : null;

  if (!record) {
    return c.text("Failed to create note", 500);
  }

  const { data } = await c.env.AI.run("@cf/baai/bge-base-en-v1.5", {
    text: [text],
  });
  const values = data[0];

  if (!values) {
    return c.text("Failed to generate vector embedding", 500);
  }

  const { id } = record;
  const inserted = await c.env.VECTOR_INDEX.upsert([
    {
      id: id.toString(),
      values,
    },
  ]);

  return c.json({ id, text, inserted });
});

app.get('/ui', async (c) => {
	return c.html(ui);
})

app.get('/write', async (c) => {
	return c.html(write);
})

app.get('/', async (c) => {
  const question = c.req.query('text') || "What is the square root of 9?"

  const embeddings = await c.env.AI.run('@cf/baai/bge-base-en-v1.5', { text: question })
  const vectors = embeddings.data[0]

  const vectorQuery = await c.env.VECTOR_INDEX.query(vectors, { topK: 1 });
  const vecId = vectorQuery.matches[0].id

  let notes = []
  console.log('vecId', vecId)
  if (vecId) {
    const query = `SELECT * FROM notes WHERE id = ?`
    const { results } = await c.env.DB.prepare(query).bind(vecId).all()
    if (results) notes = results.map(vec => vec.text)
  }

  const contextMessage = notes.length
    ? `Context:\n${notes.map(note => `- ${note}`).join("\n")}`
    : ""

  const systemPrompt = `When answering the question or responding, use the context provided, if it is provided and relevant.`

  const { response: answer } = await c.env.AI.run(
    '@cf/meta/llama-3-8b-instruct',
    {
      messages: [
        ...(notes.length ? [{ role: 'system', content: contextMessage }] : []),
        { role: 'system', content: systemPrompt },
        { role: 'user', content: question }
      ]
    }
  )

  return c.text(answer);
});


app.onError((err, c) => {
  return c.text(err)
})

export default app
