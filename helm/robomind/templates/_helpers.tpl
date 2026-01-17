{{/*
_helpers.tpl - RoboMindOS Helm Chart Helper Templates
=============================================================================
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "robomind.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "robomind.fullname" -}}
{{- if .Values.fullnameOverride }}
{{- .Values.fullnameOverride | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- $name := default .Chart.Name .Values.nameOverride }}
{{- if contains $name .Release.Name }}
{{- .Release.Name | trunc 63 | trimSuffix "-" }}
{{- else }}
{{- printf "%s-%s" .Release.Name $name | trunc 63 | trimSuffix "-" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Create chart name and version as used by the chart label.
*/}}
{{- define "robomind.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "robomind.labels" -}}
helm.sh/chart: {{ include "robomind.chart" . }}
{{ include "robomind.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "robomind.selectorLabels" -}}
app.kubernetes.io/name: {{ include "robomind.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "robomind.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "robomind.fullname" .) .Values.serviceAccount.name }}
{{- else }}
{{- default "default" .Values.serviceAccount.name }}
{{- end }}
{{- end }}

{{/*
=============================================================================
Component-specific helpers
=============================================================================
*/}}

{{/*
PostgreSQL fullname
*/}}
{{- define "robomind.postgres.fullname" -}}
{{- printf "%s-postgres" (include "robomind.fullname" .) }}
{{- end }}

{{/*
NATS fullname
*/}}
{{- define "robomind.nats.fullname" -}}
{{- printf "%s-nats" (include "robomind.fullname" .) }}
{{- end }}

{{/*
RustFS fullname
*/}}
{{- define "robomind.rustfs.fullname" -}}
{{- printf "%s-rustfs" (include "robomind.fullname" .) }}
{{- end }}

{{/*
MLflow fullname
*/}}
{{- define "robomind.mlflow.fullname" -}}
{{- printf "%s-mlflow" (include "robomind.fullname" .) }}
{{- end }}

{{/*
Server fullname
*/}}
{{- define "robomind.server.fullname" -}}
{{- printf "%s-server" (include "robomind.fullname" .) }}
{{- end }}

{{/*
App fullname
*/}}
{{- define "robomind.app.fullname" -}}
{{- printf "%s-app" (include "robomind.fullname" .) }}
{{- end }}

{{/*
Robot Agent fullname
*/}}
{{- define "robomind.robotAgent.fullname" -}}
{{- printf "%s-robot-agent" (include "robomind.fullname" .) }}
{{- end }}

{{/*
VLA Inference fullname
*/}}
{{- define "robomind.vlaInference.fullname" -}}
{{- printf "%s-vla-inference" (include "robomind.fullname" .) }}
{{- end }}

{{/*
=============================================================================
Connection string helpers
=============================================================================
*/}}

{{/*
PostgreSQL connection URL
Returns the DATABASE_URL for connecting to PostgreSQL
*/}}
{{- define "robomind.postgres.url" -}}
{{- if .Values.postgres.external.enabled }}
{{- printf "postgresql://%s:%s@%s:%v/%s" .Values.postgres.external.username .Values.postgres.auth.password .Values.postgres.external.host (int .Values.postgres.external.port) .Values.postgres.external.database }}
{{- else }}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgres.auth.username .Values.postgres.auth.password (include "robomind.postgres.fullname" .) .Values.postgres.auth.database }}
{{- end }}
{{- end }}

{{/*
NATS servers URL
Returns the NATS_SERVERS connection string
*/}}
{{- define "robomind.nats.servers" -}}
{{- if .Values.nats.external.enabled }}
{{- .Values.nats.external.servers }}
{{- else if .Values.nats.enabled }}
{{- printf "nats://%s:4222" (include "robomind.nats.fullname" .) }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
RustFS endpoint URL
Returns the RUSTFS_ENDPOINT for S3-compatible storage
*/}}
{{- define "robomind.rustfs.endpoint" -}}
{{- if .Values.rustfs.external.enabled }}
{{- .Values.rustfs.external.endpoint }}
{{- else if .Values.rustfs.enabled }}
{{- printf "http://%s:9000" (include "robomind.rustfs.fullname" .) }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
MLflow tracking URI
Returns the MLFLOW_TRACKING_URI
*/}}
{{- define "robomind.mlflow.trackingUri" -}}
{{- if .Values.mlflow.external.enabled }}
{{- .Values.mlflow.external.trackingUri }}
{{- else if .Values.mlflow.enabled }}
{{- printf "http://%s:5000" (include "robomind.mlflow.fullname" .) }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
=============================================================================
Secret validation helpers
=============================================================================
*/}}

{{/*
Validate required secrets in production mode
*/}}
{{- define "robomind.validateSecrets" -}}
{{- if .Values.production.requireSecrets }}
{{- if eq .Values.secrets.jwtSecret "dev-secret-change-in-production" }}
{{- fail "PRODUCTION ERROR: secrets.jwtSecret must be set to a secure value in production (not the default)" }}
{{- end }}
{{- if and .Values.postgres.enabled (eq .Values.postgres.auth.password "robomind-dev") }}
{{- fail "PRODUCTION ERROR: postgres.auth.password must be set to a secure value in production (not the default)" }}
{{- end }}
{{- if and .Values.rustfs.enabled (eq .Values.rustfs.auth.accessKey "rustfsadmin") }}
{{- fail "PRODUCTION ERROR: rustfs.auth.accessKey must be set to a secure value in production (not the default)" }}
{{- end }}
{{- if and .Values.rustfs.enabled (eq .Values.rustfs.auth.secretKey "rustfsadmin") }}
{{- fail "PRODUCTION ERROR: rustfs.auth.secretKey must be set to a secure value in production (not the default)" }}
{{- end }}
{{- end }}
{{- end }}

{{/*
Image pull secrets
*/}}
{{- define "robomind.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
