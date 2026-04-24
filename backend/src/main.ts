import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { readFileSync } from 'fs';
import { AppModule } from './app.module';
import { CryptoReadinessService } from './crypto/crypto-readiness.service';

async function bootstrap() {
  const enforceTls = process.env.REQUIRE_TLS !== 'false';
  const isProduction = process.env.NODE_ENV === 'production';
  const sslEnabled = process.env.SSL_ENABLED === 'true';
  const sslKeyPath = process.env.SSL_KEY_PATH;
  const sslCertPath = process.env.SSL_CERT_PATH;
  if (enforceTls && (isProduction || process.env.REQUIRE_TLS === 'true') && !sslEnabled) {
    throw new Error('TLS is required: set SSL_ENABLED=true and provide SSL_KEY_PATH/SSL_CERT_PATH');
  }

  const app = await NestFactory.create(AppModule, {
    ...(sslEnabled && sslKeyPath && sslCertPath
      ? {
          httpsOptions: {
            key: readFileSync(sslKeyPath),
            cert: readFileSync(sslCertPath),
          },
        }
      : {}),
  });
  const port = Number(process.env.PORT) || 3000;
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['*'],
    exposedHeaders: ['*'],
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
  app.get(CryptoReadinessService).assertRuntimeReadiness();
  await app.listen(port);
}

bootstrap();
