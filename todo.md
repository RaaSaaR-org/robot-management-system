# Production Readiness TODO

This document summarizes improvements needed to make the VLA (Vision-Language-Action) features production-ready, based on the implementation review of tasks 51, 53, 54, 55, 56, 57, 58, and 59.

---

## Recently Completed (2026-01-17)

### Database Persistence Migration

All VLA-related services have been migrated from in-memory Maps to Prisma database storage:

**New Prisma Models Added:**
- `SyntheticJob` - Synthetic data generation job tracking
- `SimToRealValidation` - Sim-to-real validation results
- `FederatedRound` - Federated learning round coordination
- `FederatedParticipant` - Participants in federated rounds
- `RobotPrivacyBudget` - Differential privacy budget tracking
- `InterventionRecord` - ROHE intervention records
- `PredictionLog` - VLA prediction confidence logs
- `CollectionTarget` - Active learning data collection targets

**Previously Existing Models (now in use):**
- `TeleoperationSession` - Teleop session management
- `TeleoperationFrame` - Frame data storage
- `DatasetProvenance` - Dataset provenance tracking
- `TrainingDataSummary` - Training data documentation
- `BiasAssessment` - Bias assessment records

**Services Updated:**
- `TeleoperationService.ts` - Full Prisma integration
- `SyntheticDataService.ts` - Full Prisma integration
- `FederatedLearningService.ts` - Full Prisma integration
- `TrainingDataDocService.ts` - Full Prisma integration
- `ActiveLearningService.ts` - Full Prisma integration

**Route Files Fixed:**
- Added `await` keywords to all async service calls in `active-learning.routes.ts`, `federated.routes.ts`, `synthetic.routes.ts`

---

## Task 51: Embodiment Configuration System

**Status:** Complete and production-ready

**Files:**
- `robot-agent/src/embodiment/configs/h1.yaml`
- `robot-agent/src/embodiment/configs/so101.yaml`
- `robot-agent/src/embodiment/embodiment-loader.ts`
- `robot-agent/src/embodiment/normalizer.ts`
- `robot-agent/src/embodiment/camera-config.ts`
- `robot-agent/src/embodiment/joint-mapper.ts`
- `server/src/services/EmbodimentService.ts`
- `server/src/routes/embodiments.routes.ts`

**Improvements:**
- [ ] Add more robot embodiment configs (UR5, Franka Panda, etc.)
- [ ] Add validation for embodiment config schema on upload
- [ ] Add embodiment versioning for backward compatibility
- [ ] Add unit tests for edge cases in normalizer and joint-mapper

---

## Task 53: Advanced Data Quality Validation Pipeline

**Status:** Complete and production-ready

**Files:**
- `server/src/services/DataQualityService.ts`
- `server/src/types/data-quality.types.ts`
- `server/src/routes/datasets.routes.ts`

**Improvements:**
- [ ] Implement actual cVAE model for OOD detection (currently placeholder)
- [ ] Add GPU acceleration for large dataset quality analysis
- [ ] Add background job queue for quality validation (NATS integration)
- [ ] Add quality threshold configurability per dataset/embodiment
- [ ] Add quality trend tracking over time
- [ ] Add export of quality reports (PDF/CSV)

---

## Task 54: Teleoperation Data Collection Infrastructure

**Status:** Functional MVP - needs production hardening

**Files:**
- `server/src/services/TeleoperationService.ts`
- `server/src/routes/teleoperation.routes.ts`
- `server/src/types/teleoperation.types.ts`

### High Priority

- [x] ~~**Database Persistence:** Add Prisma models for sessions and frames~~ (Completed 2026-01-17)

- [ ] **Robot Agent Modules:** Implement missing modules:
  - `robot-agent/src/teleoperation/teleop-server.ts` - WebSocket server for teleop commands
  - `robot-agent/src/teleoperation/teleop-recorder.ts` - Frame recording with ring buffer
  - `robot-agent/src/teleoperation/bilateral-adapter.ts` - Leader-follower arm mapping

- [ ] **LeRobot Export:** Current implementation is a stub. Need:
  - Convert frames to Parquet tables
  - Generate `meta/info.json`, `meta/stats.json`, `meta/episodes.json`
  - Upload to RustFS datasets bucket
  - Validate exported structure with LeRobot tools

### Medium Priority

- [ ] Add WebSocket endpoint for real-time frame streaming
- [ ] Add camera frame capture and storage to RustFS
- [ ] Add session recovery after connection loss
- [ ] Add operator authentication and authorization
- [ ] Add rate limiting for frame recording endpoints
- [ ] Add compression for frame data transmission

### Low Priority

- [ ] Add VR-specific adaptors (Quest SDK, Vision Pro SDK)
- [ ] Add haptic feedback support for bilateral teleoperation
- [ ] Add session replay functionality
- [ ] Add multi-operator support for collaborative demonstrations

---

## Task 55: Synthetic Data Generation Pipeline (Isaac Lab)

**Status:** Functional MVP - needs production hardening

**Files:**
- `server/src/services/SyntheticDataService.ts`
- `server/src/routes/synthetic.routes.ts`
- `server/src/types/synthetic.types.ts`

### High Priority

- [x] ~~**Database Persistence:** Add Prisma models for jobs and validations~~ (Completed 2026-01-17)

- [ ] **NATS Worker:** Create separate worker for job processing:
  - `server/src/workers/synthetic-data.worker.ts`
  - Subscribe to `jobs.synthetic.generate`
  - Report progress to KV store
  - Handle job completion/failure

- [ ] **Isaac Lab Integration:** Currently simulated. Need:
  - REST/gRPC client for Isaac Lab service
  - Job submission and status polling
  - Output retrieval and conversion to LeRobot format
  - Error handling and retry logic

### Medium Priority

- [ ] Add job queue with priority support
- [ ] Add GPU resource management and scheduling
- [ ] Add Isaac Lab service health monitoring
- [ ] Add automatic domain randomization tuning based on sim-to-real gap
- [ ] Add A/B testing execution (currently only types defined)
- [ ] Add cost estimation for job submission

### Low Priority

- [ ] Add custom task script upload and validation
- [ ] Add visualization of generated trajectories
- [ ] Add domain randomization parameter search
- [ ] Add multi-GPU job distribution
- [ ] Add integration with cloud GPU providers (AWS, GCP)

---

## Task 56: Fleet Learning Infrastructure (Federated Averaging)

**Status:** Functional MVP - needs production hardening

**Files:**
- `server/src/services/FederatedLearningService.ts`
- `server/src/routes/federated.routes.ts`
- `server/src/types/federated.types.ts`

### High Priority

- [x] ~~**Database Persistence:** Add Prisma models for rounds, participants, and privacy budgets~~ (Completed 2026-01-17)

- [ ] **Robot Agent Modules:** Implement missing modules:
  - `robot-agent/src/federated/local-trainer.ts` - On-device fine-tuning (LoRA-based)
  - `robot-agent/src/federated/gradient-uploader.ts` - Upload model updates with local DP noise
  - `robot-agent/src/federated/differential-privacy.ts` - Gradient clipping and noise injection

- [ ] **Secure Aggregation:** Currently not implemented. Need:
  - Additive masking for privacy
  - Secure multi-party computation (optional)
  - Verification of aggregated results

### Medium Priority

- [ ] Add FedProx and SCAFFOLD aggregation methods (currently only FedAvg)
- [ ] Add straggler detection and timeout handling
- [ ] Add model compression for bandwidth efficiency
- [ ] Add convergence monitoring and early stopping
- [ ] Add privacy budget alerts when robots approach exhaustion
- [ ] Add A/B testing for federated vs centralized training

### Low Priority

- [ ] Add hierarchical federated learning (edge aggregation)
- [ ] Add asynchronous federated learning support
- [ ] Add model personalization per robot
- [ ] Add visualization of fleet learning progress
- [ ] Add integration with MLflow for experiment tracking

---

## Task 57: Data Curation & Augmentation Pipeline

**Status:** Functional MVP - needs production hardening

**Files:**
- `server/src/services/DataCurationService.ts`
- `server/src/services/DataAugmentationService.ts`
- `server/src/routes/curation.routes.ts`
- `server/src/types/curation.types.ts`

### High Priority

- [ ] **Dataset Storage Integration:** Routes return stubs - need integration with actual dataset storage (RustFS/LeRobot)
- [ ] **LLM Paraphrasing:** Current implementation uses templates. Need:
  - Integration with LLM API for high-quality paraphrases
  - Semantic diversity checking
  - Instruction validation

- [ ] **Image Augmentation:** Current implementation is placeholder. Need:
  - Proper image processing library integration (sharp, opencv)
  - Background substitution with segmentation
  - ROSIE-style generative augmentation

### Medium Priority

- [ ] Add async job processing for large dataset curation
- [ ] Add ML-based trajectory categorization (currently keyword matching)
- [ ] Add CUPID-style harmful demo detection with learned features
- [ ] Add automatic Re-Mix weight tuning based on validation performance
- [ ] Add dataset versioning for curation/augmentation results
- [ ] Add progress tracking for long-running curation jobs

### Low Priority

- [ ] Add visual inspection UI for duplicate detection results
- [ ] Add manual review workflow for flagged harmful demos
- [ ] Add A/B testing for augmentation strategies
- [ ] Add support for custom augmentation plugins
- [ ] Add curation quality metrics and reporting

---

## Task 58: Training Data Compliance Documentation (EU AI Act)

**Status:** Complete and production-ready

**Files:**
- `server/src/services/TrainingDataDocService.ts`
- `server/src/routes/training-docs.routes.ts`
- `server/src/types/training-docs.types.ts`

### High Priority

- [x] ~~**Database Persistence:** Add Prisma models for provenance, summaries, and assessments~~ (Completed 2026-01-17)

- [ ] **PDF Export:** Currently only JSON/Markdown. Need:
  - PDF generation library (puppeteer, pdfkit)
  - EU AI Act compliant template formatting
  - Digital signatures for compliance documents

### Medium Priority

- [ ] Add scheduled job for update-due alerts (6-month intervals)
- [ ] Add MLflow lineage integration for training run tracking
- [ ] Add automated bias detection from dataset statistics
- [ ] Add compliance report generation for regulatory submissions
- [ ] Add notification system for overdue updates
- [ ] Add role-based access for assessment review workflow

### Low Priority

- [ ] Add compliance dashboard in frontend
- [ ] Add comparison tool for assessment versions
- [ ] Add bulk provenance import from CSV/JSON
- [ ] Add integration with external compliance tools
- [ ] Add audit trail export for regulatory inspections

---

## Task 59: Active Learning System (VLA Data)

**Status:** Functional MVP - needs production hardening

**Files:**
- `server/src/services/ActiveLearningService.ts`
- `server/src/routes/active-learning.routes.ts`
- `server/src/types/active-learning.types.ts`

### High Priority

- [x] ~~**Database Persistence:** Add Prisma models for prediction logs and collection targets~~ (Completed 2026-01-17)

- [ ] **Ensemble Uncertainty:** Currently uses single-model confidence. Need:
  - Multi-model ensemble disagreement computation
  - Variance across model predictions
  - MC Dropout uncertainty estimation

### Medium Priority

- [ ] Add scheduled priority recalculation job
- [ ] Add notification system for high-priority targets
- [ ] Add uncertainty heatmap visualization data endpoint
- [ ] Add robot-agent integration for confidence reporting
- [ ] Add historical uncertainty trend tracking
- [ ] Add A/B testing for different priority weight configurations

### Low Priority

- [ ] Add input clustering for diversity analysis (K-means/HDBSCAN)
- [ ] Add automatic target creation from high-uncertainty categories
- [ ] Add integration with teleoperation for guided data collection
- [ ] Add collection campaign scheduling
- [ ] Add uncertainty visualization dashboard in frontend

---

## Cross-Cutting Concerns

### Database Migration
- [x] ~~Create Prisma migrations for all new models~~ (Completed 2026-01-17)
- [ ] Add database indexes for query performance
- [ ] Add data retention policies for teleoperation frames

### Authentication & Authorization
- [ ] Add user authentication to all new endpoints
- [ ] Add role-based access control (operator, admin, viewer)
- [ ] Add audit logging for compliance

### Monitoring & Observability
- [ ] Add Prometheus metrics for job processing
- [ ] Add distributed tracing for cross-service calls
- [ ] Add alerting for failed jobs and quality issues

### Testing
- [ ] Add integration tests for all new services
- [ ] Add load tests for teleoperation frame recording
- [ ] Add end-to-end tests for LeRobot export pipeline

### Documentation
- [ ] Add API documentation (OpenAPI/Swagger)
- [ ] Add operator guide for teleoperation
- [ ] Add Isaac Lab setup guide

---

## Summary

| Task | Status | Production Blockers |
|------|--------|---------------------|
| 51 - Embodiment Config | Ready | None |
| 53 - Data Quality | Ready | OOD detection is placeholder |
| 54 - Teleoperation | MVP | ~~Database~~, robot-agent modules, LeRobot export |
| 55 - Synthetic Data | MVP | ~~Database~~, NATS worker, Isaac Lab integration |
| 56 - Fleet Learning | MVP | ~~Database~~, robot-agent modules, secure aggregation |
| 57 - Data Curation | MVP | Dataset storage integration, LLM paraphrasing, image augmentation |
| 58 - Training Compliance | MVP | ~~Database~~, PDF export, 6-month update alerts |
| 59 - Active Learning | MVP | ~~Database~~, ensemble uncertainty, robot-agent integration |

**Estimated effort to production-ready:**
- Task 51: Ready
- Task 53: 1-2 days (OOD model integration)
- Task 54: ~1 week (robot-agent + export) - DB done
- Task 55: ~1 week (worker + Isaac Lab client) - DB done
- Task 56: ~1 week (robot-agent + secure aggregation) - DB done
- Task 57: 1 week (storage integration + LLM + image processing)
- Task 58: 2-3 days (PDF export + scheduled alerts) - DB done
- Task 59: 2-3 days (ensemble uncertainty + robot-agent) - DB done
