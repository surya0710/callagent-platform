import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import * as cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { AUTH_COOKIE_NAME } from './modules/auth/auth-cookie.util';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.use(cookieParser());
  app.use(helmet());
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',').map((o) => o.trim()) ?? true,
    credentials: true,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('AI Voice Platform API')
    .setDescription('Outbound AI voice calling platform')
    .setVersion('0.1.0')
    .addBearerAuth()
    .addCookieAuth(AUTH_COOKIE_NAME)
    .addApiKey({ type: 'apiKey', name: 'X-API-Key', in: 'header' }, 'api-key')
    .addTag('Auth')
    .addTag('Users')
    .addTag('Health')
    .addTag('Agent Prompts')
    .addTag('AI')
    .addTag('Audit Logs')
    .addTag('Customers')
    .addTag('Campaigns')
    .addTag('Calls')
    .addTag('Analytics')
    .addTag('Integrations')
    .addTag('Training')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document);

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}

bootstrap();
