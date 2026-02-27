# TASK-085 — GitHub Pages Deployment (CI/CD)

## Status: todo
## Priority: high
## Component: ci
## Blocked-by: TASK-084

---

## Ziel

GitHub Actions Workflow der die Demo-App baut und auf GitHub Pages deployed. Automatisch bei jedem Push auf `main`.

## Scope

### Neue Files

1. **`.github/workflows/deploy-demo.yml`**:

```yaml
name: Deploy Demo to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: "pages"
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: 'npm'
          cache-dependency-path: app/package-lock.json

      - name: Install dependencies
        working-directory: app
        run: npm ci

      - name: Build Demo
        working-directory: app
        env:
          VITE_DEMO_MODE: 'true'
        run: npm run build

      - name: Upload artifact
        uses: actions/upload-pages-artifact@v3
        with:
          path: app/dist

  deploy:
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    runs-on: ubuntu-latest
    needs: build
    steps:
      - name: Deploy to GitHub Pages
        id: deployment
        uses: actions/deploy-pages@v4
```

### Manual Setup (Igor macht das nach dem PR-Merge)

GitHub Repo Settings → Pages → Source: **GitHub Actions**

## Verify

- Push auf main → Actions → `Deploy Demo to GitHub Pages` → grün
- URL: `https://raasaar-org.github.io/robot-management-system/`
- Landing Page lädt, Dashboard zeigt Demo-Daten

## Deliverable

- PR auf `feat/TASK-085-github-pages`
- `/tmp/devin-result.md`
