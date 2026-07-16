# L'Oréal Product-Aware Routine Builder Chatbot

A polished browser-based beauty routine builder that lets users browse real products from `products.json`, filter and search the catalog, select favorites, save selections in localStorage, generate a personalized routine through a Cloudflare Worker, and continue the conversation with follow-up questions.

## Main Features

- Product catalog loaded from `products.json`
- Search and category filters that work together
- Product cards with selection controls and accessible details dialog
- Selected-products panel with remove and clear-all actions
- Saved selections and preferences in localStorage
- Optional routine preferences for skincare, haircare, makeup, fragrance, and mixed routines
- Routine generation and follow-up chat through a Cloudflare Worker
- Responsive layout with RTL/LTR direction toggle
- Loading, empty, and error states with aria-live announcements

## Technologies Used

- HTML
- CSS
- Plain JavaScript
- Cloudflare Workers
- OpenAI Responses API

## Local Preview

1. Open the project folder in VS Code.
2. Use a simple local server such as Live Server or a static server.
3. Make sure the site is served over HTTP, not by opening `index.html` directly from disk.

Example with Python:

```bash
python3 -m http.server 5500
```

Then open `http://localhost:5500`.

## Cloudflare Worker Setup

1. Open the `worker` folder.
2. Install the Worker dependencies if you want to run it locally with Wrangler.
3. Set the secret API key securely with Wrangler:

```bash
cd worker
wrangler secret put OPENAI_API_KEY
```

4. Optional: set a model name with a Worker variable or keep the default in the code.
5. Deploy the Worker with Wrangler when you are ready.

## Where to Paste the Worker URL

Paste the deployed Worker URL into the `WORKER_URL` constant in `script.js`.

## GitHub Pages Deployment

1. Commit the finished static site files and the Worker folder.
2. In GitHub, open the repository settings and enable GitHub Pages from the `main` branch.
3. Update the Worker CORS allowlist in `worker/src/index.js` if the final Pages origin changes.
4. Revisit `script.js` and replace the Worker URL placeholder with the deployed endpoint.

## Testing Checklist

- Products load successfully.
- Category filtering works.
- Search works and combines with category filtering.
- Product details open and close with keyboard and mouse.
- Products can be selected, removed, and cleared.
- Selections restore after refresh.
- Generate is disabled when no products are selected.
- Generate sends selected products and preferences to the Worker.
- Follow-up chat reuses conversation history.
- Mobile layout does not overflow horizontally.
- RTL mode changes the layout direction.

## Security Reminder

Never commit the OpenAI API key to this repository. The key belongs only in the Cloudflare Worker secret store, not in frontend JavaScript, HTML, JSON, localStorage, or any committed config file.
