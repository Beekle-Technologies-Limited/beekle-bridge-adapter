import { createHash, timingSafeEqual } from 'node:crypto';
import { CanActivate, ExecutionContext, Inject, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { AppConfig } from '../config/env.js';
import { AppError } from '../common/errors.js';

export interface Actor {
  role: 'merchant' | 'operator';
  merchantId: string | null;
}

export const APP_CONFIG = Symbol('APP_CONFIG');

@Injectable()
export class MerchantGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    request.actor = requireActor(this.config, request.header('authorization'));
    return true;
  }
}

@Injectable()
export class OperatorGuard implements CanActivate {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { actor?: Actor }>();
    const headerActor = actorFromAuthorization(this.config, request.header('authorization'));
    if (headerActor?.role === 'operator') {
      request.actor = headerActor;
      return true;
    }
    if (operatorCookieMatches(this.config.operatorApiKey, request.header('cookie'))) {
      request.actor = { role: 'operator', merchantId: null };
      return true;
    }
    throw new AppError(401, 'unauthorized', 'Operator authentication is required');
  }
}

export function requireActor(config: AppConfig, authorization: string | undefined): Actor {
  const actor = actorFromAuthorization(config, authorization);
  if (!actor) throw new AppError(401, 'unauthorized', 'Missing or invalid bearer token');
  return actor;
}

export function actorFromAuthorization(config: AppConfig, authorization: string | undefined): Actor | null {
  if (!authorization || !authorization.startsWith('Bearer ')) return null;
  const token = authorization.slice('Bearer '.length).trim();
  if (!token) return null;
  if (tokenEquals(token, config.operatorApiKey)) return { role: 'operator', merchantId: null };
  const merchant = config.merchants.find((candidate) => tokenEquals(token, candidate.apiKey));
  if (!merchant) return null;
  return { role: 'merchant', merchantId: merchant.merchantId };
}

export function operatorSessionValue(operatorApiKey: string): string {
  return createHash('sha256').update(`beekle-operator-session:${operatorApiKey}`).digest('hex');
}

export function operatorCookieMatches(operatorApiKey: string, cookieHeader: string | undefined): boolean {
  const value = readCookie(cookieHeader, 'beekle_operator');
  if (!value) return false;
  return tokenEquals(value, operatorSessionValue(operatorApiKey));
}

export function tokenEquals(left: string, right: string): boolean {
  const a = createHash('sha256').update(left).digest();
  const b = createHash('sha256').update(right).digest();
  return timingSafeEqual(a, b);
}

function readCookie(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 0) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    return decodeURIComponent(part.slice(separator + 1).trim());
  }
  return null;
}
