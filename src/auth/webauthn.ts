// src/auth/webauthn.ts: WebAuthn (Passkey) logic with @simplewebauthn/server
import {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import { isoBase64URL } from '@simplewebauthn/server/helpers';
import type {
  RegistrationResponseJSON,
  AuthenticationResponseJSON,
} from '@simplewebauthn/server';
import type { Bindings, User, Credential } from '../types';

export async function createRegOptions(
  env: Bindings,
  user: User,
  existingCreds: Credential[]
) {
  const options = await generateRegistrationOptions({
    rpName: env.RP_NAME,
    rpID: env.RP_ID,
    userID: isoBase64URL.toBuffer(user.id),
    userName: user.username,
    userDisplayName: user.display_name,
    attestationType: 'none',
    excludeCredentials: existingCreds.map((cred) => ({
      id: cred.id,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    })),
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
  });

  // Temporarily save challenge
  await env.DB.prepare('UPDATE users SET current_challenge = ? WHERE id = ?')
    .bind(options.challenge, user.id)
    .run();

  return options;
}

export async function verifyRegResponse(
  env: Bindings,
  user: User,
  response: RegistrationResponseJSON,
  expectedChallenge?: string
) {
  const challenge = expectedChallenge || user.current_challenge;
  if (!challenge) {
    throw new Error('No pending registration challenge found');
  }

  const verification = await verifyRegistrationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.EXPECTED_ORIGIN,
    expectedRPID: env.RP_ID,
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.registrationInfo) {
    throw new Error('Registration verification failed');
  }

  const { credential } = verification.registrationInfo;

  // Save credential to database
  const credId = credential.id;
  const publicKeyB64 = isoBase64URL.fromBuffer(credential.publicKey);
  const counter = credential.counter;
  const transports = response.response.transports
    ? JSON.stringify(response.response.transports)
    : null;

  await env.DB.prepare(
    `INSERT INTO credentials (id, user_id, public_key, counter, device_type, backed_up, transports)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  )
    .bind(
      credId,
      user.id,
      publicKeyB64,
      counter,
      verification.registrationInfo.credentialDeviceType,
      verification.registrationInfo.credentialBackedUp ? 1 : 0,
      transports
    )
    .run();

  // Clear challenge
  await env.DB.prepare('UPDATE users SET current_challenge = NULL WHERE id = ?')
    .bind(user.id)
    .run();

  return verification;
}

export async function createAuthOptions(env: Bindings, user?: User) {
  let allowCredentials = undefined;

  if (user) {
    const creds = await env.DB.prepare(
      'SELECT id, transports FROM credentials WHERE user_id = ?'
    )
      .bind(user.id)
      .all<Pick<Credential, 'id' | 'transports'>>();

    if (creds.results && creds.results.length > 0) {
      allowCredentials = creds.results.map((c) => ({
        id: c.id,
        transports: c.transports ? JSON.parse(c.transports) : undefined,
      }));
    }
  }

  const options = await generateAuthenticationOptions({
    rpID: env.RP_ID,
    allowCredentials,
    userVerification: 'preferred',
  });

  if (user) {
    await env.DB.prepare('UPDATE users SET current_challenge = ? WHERE id = ?')
      .bind(options.challenge, user.id)
      .run();
  }

  return options;
}

export async function verifyAuthResponse(
  env: Bindings,
  user: User,
  response: AuthenticationResponseJSON,
  expectedChallenge?: string
) {
  const challenge = expectedChallenge || user.current_challenge;
  if (!challenge) {
    throw new Error('No pending authentication challenge found');
  }

  // Retrieve matching credential
  const cred = await env.DB.prepare(
    'SELECT * FROM credentials WHERE id = ? AND user_id = ?'
  )
    .bind(response.id, user.id)
    .first<Credential>();

  if (!cred) {
    throw new Error('Authenticator credential not registered for this user');
  }

  const verification = await verifyAuthenticationResponse({
    response,
    expectedChallenge: challenge,
    expectedOrigin: env.EXPECTED_ORIGIN,
    expectedRPID: env.RP_ID,
    credential: {
      id: cred.id,
      publicKey: isoBase64URL.toBuffer(cred.public_key),
      counter: cred.counter,
      transports: cred.transports ? JSON.parse(cred.transports) : undefined,
    },
    requireUserVerification: false,
  });

  if (!verification.verified || !verification.authenticationInfo) {
    throw new Error('Authentication verification failed');
  }

  // Update counter
  await env.DB.prepare('UPDATE credentials SET counter = ? WHERE id = ?')
    .bind(verification.authenticationInfo.newCounter, cred.id)
    .run();

  // Clear challenge
  await env.DB.prepare('UPDATE users SET current_challenge = NULL WHERE id = ?')
    .bind(user.id)
    .run();

  return verification;
}
