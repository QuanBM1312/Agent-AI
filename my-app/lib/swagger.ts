import swaggerJsdoc from 'swagger-jsdoc';

const options: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'My Next.js API',
      version: '1.0.0',
      description: 'API documentation for my Next.js application',
    },
    servers: [
        {
            url: 'http://localhost:3000',
            description: 'Development server',
        },
    ],
  },
  apis: ['./app/api/**/*.ts', './app/api/**/*.tsx'], // Đường dẫn tới các file API của bạn
};

export const getApiDocs = () => {
  const spec = swaggerJsdoc(options);
  return spec;
};
