#!/bin/bash
# Create MLflow database for model registry
# This script runs during PostgreSQL container initialization

set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    -- Create MLflow database if it doesn't exist
    SELECT 'CREATE DATABASE mlflow'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'mlflow')\gexec

    -- Grant all privileges on mlflow database to the main user
    GRANT ALL PRIVILEGES ON DATABASE mlflow TO $POSTGRES_USER;

    \c mlflow

    -- Grant schema privileges
    GRANT ALL ON SCHEMA public TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO $POSTGRES_USER;
    GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO $POSTGRES_USER;
EOSQL

echo "MLflow database created successfully"
