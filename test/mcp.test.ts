// test/mcp.test.ts: Model Context Protocol (MCP) Remote Endpoint Tests
import { describe, it, expect } from 'vitest';
import { createTestContext } from './helpers/testApp';
import { createSessionToken } from '../src/auth/session';

describe('Model Context Protocol (MCP) Endpoint', () => {
  it('handles "initialize" request correctly with 2024-11-05 protocol version', async () => {
    const { request } = createTestContext();

    const res = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'claude-desktop', version: '1.0.0' },
        },
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.jsonrpc).toBe('2.0');
    expect(body.id).toBe(1);
    expect(body.result.protocolVersion).toBe('2024-11-05');
    expect(body.result.serverInfo.name).toBe('tossa');
    expect(body.result.capabilities.tools).toBeDefined();
    expect(body.result.capabilities.resources).toBeDefined();
    expect(body.result.capabilities.prompts).toBeDefined();
  });

  it('handles "ping" and "notifications/initialized"', async () => {
    const { request } = createTestContext();

    // ping
    const pingRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'ping',
      }),
    });
    const pingBody = await pingRes.json<any>();
    expect(pingBody.jsonrpc).toBe('2.0');
    expect(pingBody.id).toBe(2);
    expect(pingBody.result).toEqual({});

    // notifications/initialized (notification without id should return 204)
    const notifRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'notifications/initialized',
      }),
    });
    expect(notifRes.status).toBe(204);
  });

  it('lists available tools with "tools/list"', async () => {
    const { request } = createTestContext();

    const res = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/list',
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json<any>();
    expect(body.result.tools).toBeInstanceOf(Array);
    const toolNames = body.result.tools.map((t: any) => t.name);
    expect(toolNames).toContain('search_posts');
    expect(toolNames).toContain('get_post');
    expect(toolNames).toContain('get_emergency_summary');
    expect(toolNames).toContain('get_categories');
    expect(toolNames).toContain('get_vocabulary_tags');
    expect(toolNames).toContain('get_areas');
    expect(toolNames).toContain('create_post');
    expect(toolNames).toContain('update_status');
    expect(toolNames).toContain('verify_post');
  });

  it('executes tools/call: create_post, search_posts, get_post, update_status, and verify_post', async () => {
    const { request } = createTestContext();

    // 1. create_post via unauthenticated agent
    const createRes = await request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-agent-id': 'agent_test_runner_1',
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 10,
        method: 'tools/call',
        params: {
          name: 'create_post',
          arguments: {
            title: '清水市民センター 給水所',
            area: '中央区',
            category_id: 'water',
            current_status: 'available',
            status_label: '給水中',
            note: '1人20Lまで。容器をご持参ください。',
            tags: ['給水', '容器持参'],
          },
        },
      }),
    });

    expect(createRes.status).toBe(200);
    const createBody = await createRes.json<any>();
    expect(createBody.result.isError).toBe(false);
    const createdData = JSON.parse(createBody.result.content[0].text);
    expect(createdData.success).toBe(true);
    expect(createdData.post_id).toBeTruthy();
    expect(createdData.is_verified).toBe(false);
    const postId = createdData.post_id;

    // 2. search_posts
    const searchRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 11,
        method: 'tools/call',
        params: {
          name: 'search_posts',
          arguments: {
            query: '清水市民センター',
          },
        },
      }),
    });

    const searchBody = await searchRes.json<any>();
    const searchData = JSON.parse(searchBody.result.content[0].text);
    expect(searchData.count).toBeGreaterThanOrEqual(1);
    expect(searchData.posts[0].title).toBe('清水市民センター 給水所');
    expect(searchData.posts[0].status_label).toBe('給水中');

    // 3. get_post
    const getRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 12,
        method: 'tools/call',
        params: {
          name: 'get_post',
          arguments: { id: postId },
        },
      }),
    });
    const getBody = await getRes.json<any>();
    const getData = JSON.parse(getBody.result.content[0].text);
    expect(getData.post.id).toBe(postId);
    expect(getData.post.area).toBe('中央区');

    // 4. get_emergency_summary
    const summaryRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 13,
        method: 'tools/call',
        params: {
          name: 'get_emergency_summary',
          arguments: { area: '中央区' },
        },
      }),
    });
    const summaryBody = await summaryRes.json<any>();
    const summaryData = JSON.parse(summaryBody.result.content[0].text);
    expect(summaryData.disaster_facilities_total).toBeGreaterThanOrEqual(1);
    expect(
      summaryData.status_breakdown.available_利用可能
    ).toBeGreaterThanOrEqual(1);

    // 5. update_status
    const updateRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 14,
        method: 'tools/call',
        params: {
          name: 'update_status',
          arguments: {
            post_id: postId,
            status: 'crowded',
            status_label: '混雑中',
            note: '待ち時間約30分',
          },
        },
      }),
    });
    const updateBody = await updateRes.json<any>();
    const updateData = JSON.parse(updateBody.result.content[0].text);
    expect(updateData.success).toBe(true);
    expect(updateData.status).toBe('crowded');

    // 6. verify_post
    const verifyRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 15,
        method: 'tools/call',
        params: {
          name: 'verify_post',
          arguments: { post_id: postId },
        },
      }),
    });
    const verifyBody = await verifyRes.json<any>();
    const verifyData = JSON.parse(verifyBody.result.content[0].text);
    expect(verifyData.success).toBe(true);
    expect(verifyData.current_verification_count).toBeGreaterThanOrEqual(1);
  });

  it('lists and reads resources', async () => {
    const { request, db } = createTestContext();

    await db
      .prepare(
        "INSERT INTO categories (id, name, icon, color, scope) VALUES ('water', '給水所', '💧', '#3b82f6', 'disaster')"
      )
      .run();

    // resources/list
    const listRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 20,
        method: 'resources/list',
      }),
    });
    const listBody = await listRes.json<any>();
    expect(listBody.result.resources.length).toBeGreaterThanOrEqual(3);

    // resources/read
    const readRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 21,
        method: 'resources/read',
        params: { uri: 'tossa://categories' },
      }),
    });
    const readBody = await readRes.json<any>();
    expect(readBody.result.contents[0].uri).toBe('tossa://categories');
    expect(readBody.result.contents[0].text).toContain('name');
  });

  it('lists and gets prompts', async () => {
    const { request } = createTestContext();

    // prompts/list
    const listRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 30,
        method: 'prompts/list',
      }),
    });
    const listBody = await listRes.json<any>();
    expect(listBody.result.prompts.length).toBeGreaterThanOrEqual(2);

    // prompts/get
    const getRes = await request('/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 31,
        method: 'prompts/get',
        params: {
          name: 'tossa_find_supplies',
          arguments: { supplies: '給水用ポリタンク', area: '中央区' },
        },
      }),
    });
    const getBody = await getRes.json<any>();
    expect(getBody.result.messages[0].content.text).toContain(
      '給水用ポリタンク'
    );
  });

  it('supports issuing API Token via POST /api/auth/api-tokens and authenticating in MCP', async () => {
    const { request, db, env } = createTestContext();

    // Setup an admin user in D1
    await db
      .prepare(
        "INSERT INTO users (id, username, display_name, role) VALUES ('admin_test_mcp', 'mcp_admin', 'MCP管理者', 'admin')"
      )
      .run();

    const sessionToken = await createSessionToken(
      {
        userId: 'admin_test_mcp',
        username: 'mcp_admin',
        displayName: 'MCP管理者',
        role: 'admin',
      },
      env.JWT_SECRET
    );

    // 1. Issue API Token
    const tokenRes = await request('/api/auth/api-tokens', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${sessionToken}`,
      },
      body: JSON.stringify({
        name: 'Cursor MCP Integration',
        expiresInDays: 90,
      }),
    });

    expect(tokenRes.status).toBe(200);
    const tokenBody = await tokenRes.json<any>();
    expect(tokenBody.success).toBe(true);
    expect(tokenBody.token.startsWith('tossa_pat_')).toBe(true);
    expect(tokenBody.tokenName).toBe('Cursor MCP Integration');

    // 2. Use this tossa_pat_ token to create post as Admin (is_verified: true)
    const mcpRes = await request('/mcp', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${tokenBody.token}`,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 40,
        method: 'tools/call',
        params: {
          name: 'create_post',
          arguments: {
            title: '公式発表: 市役所前 本部給水拠点 開設',
            area: '中央区',
            category_id: 'water',
            current_status: 'available',
            status_label: '公式開設中',
            note: '自衛隊による給水支援。24時間稼働。',
          },
        },
      }),
    });

    expect(mcpRes.status).toBe(200);
    const mcpBody = await mcpRes.json<any>();
    const postData = JSON.parse(mcpBody.result.content[0].text);
    expect(postData.success).toBe(true);
    // As admin, post is officially verified
    expect(postData.is_verified).toBe(true);
    expect(postData.author).toBe('MCP管理者');
  });

  it('serves GET /mcp with JSON or HTML overview', async () => {
    const { request } = createTestContext();

    // JSON Accept
    const jsonRes = await request('/mcp', {
      method: 'GET',
      headers: { Accept: 'application/json' },
    });
    expect(jsonRes.status).toBe(200);
    const jsonBody = await jsonRes.json<any>();
    expect(jsonBody.name).toBe('tossa-mcp');
    expect(jsonBody.tools_count).toBeGreaterThanOrEqual(9);

    // HTML Accept
    const htmlRes = await request('/mcp', {
      method: 'GET',
      headers: { Accept: 'text/html' },
    });
    expect(htmlRes.status).toBe(200);
    const htmlText = await htmlRes.text();
    expect(htmlText).toContain('tossa MCP Server');
    expect(htmlText).toContain('claude_desktop_config.json');
  });
});
