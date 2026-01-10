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
{{- printf "%s" $name | trunc 63 | trimSuffix "-" }}
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
{{- default (include "robomind.fullname" .) .Values.serviceAccount.name }}
{{- end }}

{{/*
Return the proper image name
*/}}
{{- define "robomind.image" -}}
{{- $registryName := .Values.global.imageRegistry -}}
{{- $repositoryName := .repository -}}
{{- $tag := .tag | toString -}}
{{- if $registryName }}
{{- printf "%s/%s:%s" $registryName $repositoryName $tag -}}
{{- else }}
{{- printf "%s:%s" $repositoryName $tag -}}
{{- end }}
{{- end }}

{{/*
Return the namespace
*/}}
{{- define "robomind.namespace" -}}
{{- .Values.global.namespace | default .Release.Namespace }}
{{- end }}

{{/*
Return database URL
*/}}
{{- define "robomind.databaseUrl" -}}
postgresql://{{ .Values.postgres.auth.username }}:{{ .Values.postgres.auth.password }}@{{ include "robomind.fullname" . }}-postgres:5432/{{ .Values.postgres.auth.database }}
{{- end }}
