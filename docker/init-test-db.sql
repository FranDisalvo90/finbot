-- Creates the test database alongside the default finbot database.
-- This script runs automatically on first container init (pgdata volume empty).
SELECT 'CREATE DATABASE finbot_test'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'finbot_test')\gexec
