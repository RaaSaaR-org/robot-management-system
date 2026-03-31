---
id: TASK-115
aliases:
- TASK-115
title: 'HF Push: Dataset auf HuggingFace veröffentlichen'
slug: hf-push-dataset-auf-huggingface-ver-ffentlichen
status: todo
priority: 2
owner: ''
projects: []
customers: []
tags:
- datasets
- huggingface
- training
sprint: ''
depends_on:
- TASK-116
due_date: ''
created: 2026-03-31
updated: 2026-03-31
---


# HF Push: Dataset auf HuggingFace veröffentlichen

## Description

Dataset aus RustFS-Storage direkt auf den HuggingFace Hub pushen — der letzte Schritt im Workflow: Teleop → LeRobot Export → HF veröffentlichen.

**Backend (`POST /api/datasets/:id/push-to-hub`):**
- HF Token aus Request-Body oder Env (`HF_TOKEN`)
- LeRobot-Dateien aus RustFS lesen (Parquet + info.json + stats.json)
- In temp-dir schreiben, dann via `huggingface_hub` Python-Script pushen (`upload_folder()`)
- Repo-Name konfigurierbar (z.B. `username/my-so101-dataset`)
- Visibility: `public` / `private` wählbar
- Fortschritt via NATS event / WebSocket

**Frontend (Dataset-Detailseite):**
- "Auf HuggingFace veröffentlichen" Button
- Modal: HF-Token (oder aus User-Settings), Repo-Name, public/private
- Upload-Fortschritt anzeigen
- Nach Erfolg: HF-URL anzeigen + direkter Link

**Abhängigkeiten:**
- `huggingface_hub` Python-Package muss auf dem Pi verfügbar sein (`pip install huggingface_hub`)
- TASK-116 empfohlen (damit Datasets überhaupt im System sind)

## Acceptance Criteria
- [ ] `POST /api/datasets/:id/push-to-hub` gibt 202 zurück, Push läuft im Background
- [ ] Eigener Datensatz erscheint auf huggingface.co nach erfolgreichem Push
- [ ] Fehler (ungültiger Token, Repo existiert bereits, Netzwerk) werden sauber angezeigt
- [ ] HF-URL wird nach Push im Dataset-Record gespeichert (`huggingFaceRepoId`)
- [ ] TypeScript: 0 errors

## Notes

Python-Script Beispiel:
```python
from huggingface_hub import HfApi
api = HfApi(token=hf_token)
api.upload_folder(folder_path=local_dir, repo_id=repo_id, repo_type="dataset")
```
