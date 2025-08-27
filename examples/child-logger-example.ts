import * as traceroot from '../src/index';

const main = traceroot.traceFunction(
  async function main() {
    // Get the main logger
    const logger = traceroot.get_logger();
    logger.info('Main logger initialized');

    // Create child loggers with different contexts
    const authLogger = logger.child({ module: 'auth' });
    const dbLogger = logger.child({ module: 'database' });
    const apiLogger = logger.child({ module: 'api', version: '1.0' });

    // Use child loggers - context is automatically included
    authLogger.info('User login attempt started');
    authLogger.info({ userId: 'user123' }, 'Login successful');

    dbLogger.info('Connecting to database');
    dbLogger.warn({ table: 'users', query: 'SELECT *' }, 'Slow query detected');

    apiLogger.info({ endpoint: '/users', method: 'GET' }, 'API request processed');

    // Create nested child loggers
    const authLoginLogger = authLogger.child({ operation: 'login' });
    const authRegisterLogger = authLogger.child({ operation: 'register' });

    authLoginLogger.info({ userId: 'user123', sessionId: 'sess456' }, 'Processing login');
    authRegisterLogger.info({ email: 'user@example.com' }, 'New user registration');

    // Even deeper nesting
    const authLoginValidationLogger = authLoginLogger.child({ step: 'validation' });
    authLoginValidationLogger.debug('Validating user credentials');
    authLoginValidationLogger.info({ validationResult: 'success' }, 'Credentials validated');

    // Child context is persistent and not overridable (pino behavior)
    authLogger.info({ attempt: 'second' }, 'This will show both module: auth and attempt: second');

    // Create a new child logger for authLogger with a overridden module name
    const authChildLogger = authLogger.child({ module: 'auth_child', version: '2.0' });
    authChildLogger.info({ userId: 'user456' }, 'Processing login');

    // Multiple objects still work
    apiLogger.info({ requestId: 'req123' }, { userId: 'user456' }, 'Complex API operation');

    console.log('\n=== Child Logger Example Complete ===');
    console.log('All log entries above include their respective child contexts automatically!');
    console.log('- authLogger logs include { module: "auth" }');
    console.log('- dbLogger logs include { module: "database" }');
    console.log('- apiLogger logs include { module: "api", version: "1.0" }');
    console.log('- Nested loggers inherit and merge all parent contexts');
    console.log(
      '- Child context is persistent and cannot be overridden by runtime args (pino behavior)'
    );
  },
  { spanName: 'childLoggerExample', traceParams: false }
);

main()
  .then(async () => {
    await traceroot.forceFlushTracer();
    await traceroot.forceFlushLogger();
    await traceroot.shutdownLogger();
    await traceroot.shutdownTracing();
    process.exit(0);
  })
  .catch(console.error);
