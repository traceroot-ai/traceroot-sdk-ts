import * as traceroot from '../src/index';

const main = traceroot.traceFunction(
  async function main() {
    const logger = traceroot.getLogger();

    const childLogger = logger.child({
      context: {
        org_id: 'X88ZgHksdgSq17NM7kSTdwSqW268ExdT',
        org_slug: 'test_v1_88230742',
        env: 'live',
        authType: 'dashboard',
        body: {
          customer_id: '5',
          product_id: 'product_v11',
          is_custom: false,
          version: 1,
        },
        customer_id: '5',
        user_id: null,
      },
      req: {
        id: 'local_req_32AP7rnDiCl14HfyCfFiw09SKdi',
        env: 'live',
        method: 'POST',
        url: '/v1/attach/preview',
        timestamp: 1756860239428,
      },
    });
    childLogger.info('testing traceroot');
    await childLogger.flush();

    const childFunction = traceroot.traceFunction(
      async function childFunction() {
        const childLogger2 = logger.child({
          context: {
            body: {},
            req: {
              id: 'local_req_32Gfippaz6clrbxefN1HB6dkY4a',
              env: 'live',
              method: 'GET',
              url: '/customers/108/data',
              timestamp: 1757051959269,
            },
          },
          message: 'GET /customers/108/data',
        });
        childLogger2.info('testing child logger 2');
        await childLogger2.flush();
      },
      { spanName: 'childFunction', traceParams: false }
    );

    await childFunction();
  },
  { spanName: 'simpleChildLoggerContext', traceParams: false }
);

main()
  .then(async () => {
    await traceroot.forceFlushLogger();
    await traceroot.shutdownLogger();
    await traceroot.forceFlushTracer();
    await traceroot.shutdownTracer();
    process.exit(0);
  })
  .catch(console.error);
