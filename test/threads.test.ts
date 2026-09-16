// test/threads.test.ts
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Threads API (E2EE Secure Messaging)', () => {
  it('updates and retrieves user E2EE public key', async () => {
    const { request, db, env } = createTestContext();

    // Create user in DB
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user1', 'alice', 'Alice', 'user')
      .run();

    const token = await createSessionToken(
      { userId: 'user1', username: 'alice', role: 'user' },
      env.JWT_SECRET
    );

    const pubKeyJwk = JSON.stringify({
      kty: 'EC',
      crv: 'P-256',
      x: 'dummy_x',
      y: 'dummy_y',
    });

    // 1. Update public key
    const putRes = await request('/api/threads/public-key', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ publicKey: pubKeyJwk }),
    });
    expect(putRes.status).toBe(200);

    // 2. Query public keys
    const getRes = await request('/api/threads/public-keys?ids=user1', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    expect(getRes.status).toBe(200);
    const body = await getRes.json();
    expect(body.success).toBe(true);
    expect(body.users.length).toBe(1);
    expect(body.users[0].e2ee_public_key).toBe(pubKeyJwk);
  });

  it('restricts admin_chat thread creation to admin role', async () => {
    const { request, db, env } = createTestContext();

    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_normal', 'bob', 'Bob', 'user')
      .run();

    const userToken = await createSessionToken(
      { userId: 'user_normal', username: 'bob', role: 'user' },
      env.JWT_SECRET
    );

    const payload = {
      title: 'Admin Only Strategy Meeting',
      type: 'admin_chat',
      members: [
        {
          userId: 'user_normal',
          encryptedThreadKey: 'enc_key_1',
          ephemeralPublicKey: 'eph_pub_1',
          role: 'owner',
        },
      ],
    };

    // Normal user attempts to create admin_chat -> 403 Forbidden
    const failRes = await request('/api/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${userToken}`,
      },
      body: JSON.stringify(payload),
    });
    expect(failRes.status).toBe(403);
  });

  it('creates an E2EE thread, posts encrypted messages, and isolates non-members', async () => {
    const { request, db, env } = createTestContext();

    // Setup 3 users: Alice (owner), Bob (member), Eve (outsider)
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_alice', 'alice', 'Alice', 'user')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_bob', 'bob', 'Bob', 'user')
      .run();
    await db
      .prepare(
        'INSERT INTO users (id, username, display_name, role) VALUES (?, ?, ?, ?)'
      )
      .bind('user_eve', 'eve', 'Eve', 'user')
      .run();

    const aliceToken = await createSessionToken(
      { userId: 'user_alice', username: 'alice', role: 'user' },
      env.JWT_SECRET
    );
    const bobToken = await createSessionToken(
      { userId: 'user_bob', username: 'bob', role: 'user' },
      env.JWT_SECRET
    );
    const eveToken = await createSessionToken(
      { userId: 'user_eve', username: 'eve', role: 'user' },
      env.JWT_SECRET
    );

    // Alice creates thread with Bob
    const createRes = await request('/api/threads', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        title: 'Alice & Bob Secret Thread',
        type: 'direct',
        members: [
          {
            userId: 'user_alice',
            encryptedThreadKey: 'alice_enc_key',
            ephemeralPublicKey: 'alice_eph_pub',
            role: 'owner',
          },
          {
            userId: 'user_bob',
            encryptedThreadKey: 'bob_enc_key',
            ephemeralPublicKey: 'bob_eph_pub',
            role: 'member',
          },
        ],
      }),
    });
    expect(createRes.status).toBe(201);
    const createBody = await createRes.json();
    const threadId = createBody.id;
    expect(threadId).toBeTruthy();

    // Alice checks her thread list
    const listRes = await request('/api/threads', {
      headers: { Authorization: `Bearer ${aliceToken}` },
    });
    const listBody = await listRes.json();
    expect(listBody.threads.some((t: any) => t.id === threadId)).toBe(true);

    // Eve (outsider) tries to view thread details -> 403
    const eveGetRes = await request(`/api/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect(eveGetRes.status).toBe(403);

    // Eve tries to post message -> 403
    const evePostRes = await request(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${eveToken}`,
      },
      body: JSON.stringify({ ciphertext: 'fake_cipher', iv: 'fake_iv' }),
    });
    expect(evePostRes.status).toBe(403);

    // Alice posts encrypted message
    const msgRes = await request(`/api/threads/${threadId}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${aliceToken}`,
      },
      body: JSON.stringify({
        ciphertext: 'ciphertext_payload_123',
        iv: 'iv_payload_123',
      }),
    });
    expect(msgRes.status).toBe(201);

    // Bob views thread details & messages
    const bobGetRes = await request(`/api/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${bobToken}` },
    });
    expect(bobGetRes.status).toBe(200);
    const bobBody = await bobGetRes.json();
    expect(bobBody.messages.length).toBe(1);
    expect(bobBody.messages[0].ciphertext).toBe('ciphertext_payload_123');
    expect(bobBody.messages[0].sender_id).toBe('user_alice');

    // Bob invites Eve by providing encrypted thread key for Eve
    const inviteRes = await request(`/api/threads/${threadId}/members`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bobToken}`,
      },
      body: JSON.stringify({
        userId: 'user_eve',
        encryptedThreadKey: 'eve_enc_key',
        ephemeralPublicKey: 'eve_eph_pub',
      }),
    });
    expect(inviteRes.status).toBe(200);

    // Eve can now view thread details!
    const eveAllowedRes = await request(`/api/threads/${threadId}`, {
      headers: { Authorization: `Bearer ${eveToken}` },
    });
    expect(eveAllowedRes.status).toBe(200);
  });
});
