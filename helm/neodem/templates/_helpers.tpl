{{/*
_helpers.tpl - NeoDEM Helm Chart Helper Templates
=============================================================================
*/}}

{{/*
Expand the name of the chart.
*/}}
{{- define "neodem.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Create a default fully qualified app name.
*/}}
{{- define "neodem.fullname" -}}
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
{{- define "neodem.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" }}
{{- end }}

{{/*
Common labels
*/}}
{{- define "neodem.labels" -}}
helm.sh/chart: {{ include "neodem.chart" . }}
{{ include "neodem.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
{{- end }}

{{/*
Selector labels
*/}}
{{- define "neodem.selectorLabels" -}}
app.kubernetes.io/name: {{ include "neodem.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end }}

{{/*
Create the name of the service account to use
*/}}
{{- define "neodem.serviceAccountName" -}}
{{- if .Values.serviceAccount.create }}
{{- default (include "neodem.fullname" .) .Values.serviceAccount.name }}
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
{{- define "neodem.postgres.fullname" -}}
{{- printf "%s-postgres" (include "neodem.fullname" .) }}
{{- end }}

{{/*
NATS fullname
*/}}
{{- define "neodem.nats.fullname" -}}
{{- printf "%s-nats" (include "neodem.fullname" .) }}
{{- end }}

{{/*
RustFS fullname
*/}}
{{- define "neodem.rustfs.fullname" -}}
{{- printf "%s-rustfs" (include "neodem.fullname" .) }}
{{- end }}

{{/*
Server fullname
*/}}
{{- define "neodem.server.fullname" -}}
{{- printf "%s-server" (include "neodem.fullname" .) }}
{{- end }}

{{/*
App fullname
*/}}
{{- define "neodem.app.fullname" -}}
{{- printf "%s-app" (include "neodem.fullname" .) }}
{{- end }}

{{/*
Robot Agent fullname
*/}}
{{- define "neodem.robotAgent.fullname" -}}
{{- printf "%s-robot-agent" (include "neodem.fullname" .) }}
{{- end }}

{{/*
VLA Inference fullname
*/}}
{{- define "neodem.vlaInference.fullname" -}}
{{- printf "%s-vla-inference" (include "neodem.fullname" .) }}
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
{{- define "neodem.postgres.url" -}}
{{- if .Values.postgres.external.enabled }}
{{- printf "postgresql://%s:%s@%s:%v/%s" .Values.postgres.external.username .Values.postgres.auth.password .Values.postgres.external.host (int .Values.postgres.external.port) .Values.postgres.external.database }}
{{- else }}
{{- printf "postgresql://%s:%s@%s:5432/%s" .Values.postgres.auth.username .Values.postgres.auth.password (include "neodem.postgres.fullname" .) .Values.postgres.auth.database }}
{{- end }}
{{- end }}

{{/*
NATS servers URL
Returns the NATS_SERVERS connection string
*/}}
{{- define "neodem.nats.servers" -}}
{{- if .Values.nats.external.enabled }}
{{- .Values.nats.external.servers }}
{{- else if .Values.nats.enabled }}
{{- printf "nats://%s:4222" (include "neodem.nats.fullname" .) }}
{{- else }}
{{- "" }}
{{- end }}
{{- end }}

{{/*
RustFS endpoint URL
Returns the RUSTFS_ENDPOINT for S3-compatible storage
*/}}
{{- define "neodem.rustfs.endpoint" -}}
{{- if .Values.rustfs.external.enabled }}
{{- .Values.rustfs.external.endpoint }}
{{- else if .Values.rustfs.enabled }}
{{- printf "http://%s:9000" (include "neodem.rustfs.fullname" .) }}
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
{{- define "neodem.validateSecrets" -}}
{{- if .Values.production.requireSecrets }}
{{- if eq .Values.secrets.jwtSecret "dev-secret-change-in-production" }}
{{- fail "PRODUCTION ERROR: secrets.jwtSecret must be set to a secure value in production (not the default)" }}
{{- end }}
{{- if and .Values.postgres.enabled (eq .Values.postgres.auth.password "neodem-dev") }}
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
{{- define "neodem.imagePullSecrets" -}}
{{- with .Values.global.imagePullSecrets }}
imagePullSecrets:
{{- toYaml . | nindent 2 }}
{{- end }}
{{- end }}
