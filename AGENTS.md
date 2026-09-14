# Working agreement

- Continue in this project directory, `RHM Market Gantt`.
- Implement and test locally first. Do not push to GitHub or deploy to Vercel until the user explicitly asks to publish the current changes.
- Local snapshots are actual JSON files in `snapshots/`. Never commit snapshots, `.local/`, `.env*`, or `.vercel/`.
- Preserve working data and the `dashboard-state-v4` key. Do not increase APP_VERSION to reset user data.
- Keep the existing visual style. Before changing timeline geometry, verify alignment at 100%, 75%, and 50%.
- Run `npm test` and `npm run build` for changes to storage or application behavior.
