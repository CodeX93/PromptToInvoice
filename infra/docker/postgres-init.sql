-- Local-only role passwords. In production these are provisioned by Terraform.
CREATE DATABASE pti_test OWNER pti;
CREATE ROLE pti_app LOGIN NOBYPASSRLS PASSWORD 'pti_app';
CREATE ROLE pti_system LOGIN BYPASSRLS PASSWORD 'pti_system';
