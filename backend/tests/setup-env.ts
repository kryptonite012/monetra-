process.env.NODE_ENV = 'test';
process.env.TEST_DATABASE_URL ??= 'postgres://monetra:monetra@localhost:5432/monetra_test';
process.env.JOBS_ENABLED = 'false';
process.env.UPLOAD_DIR ??= require('node:path').resolve(__dirname, '../.test-storage/uploads');
process.env.REPORT_DIR ??= require('node:path').resolve(__dirname, '../.test-storage/reports');
