process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL ??= 'postgres://monetra:monetra@localhost:5432/monetra_test';
process.env.JOBS_ENABLED = 'false';
