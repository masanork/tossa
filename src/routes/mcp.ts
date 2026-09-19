// src/routes/mcp.ts: Model Context Protocol (MCP) Remote Server for tossa
import { Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import type { Bindings } from '../types';
import { verifySessionToken, type SessionPayload } from '../auth/session';
import {
  getPosts,
  getPostById,
  getStatusUpdatesByPostId,
  createPost,
  updatePostStatus,
  verifyPost,
  getCategories,
  getVocabularyTags,
} from '../db/queries';
import { broadcastPushNotification } from '../services/push';
import { getClientIp } from '../middleware/deviceCookie';

export const mcpRoute = new Hono<{ Bindings: Bindings }>();

function publicOrigin(env: Bindings): string {
  const fromEnv = env.EXPECTED_ORIGIN?.replace(/\/+$/, '');
  if (fromEnv) return fromEnv;
  return `https://${env.RP_ID || 'tossa.app'}`;
}

// ---------------- MCP Metadata Definitions ----------------

const MCP_TOOLS = [
  {
    name: 'search_posts',
    description:
      'Search community living and disaster info posts in tossa (e.g. water stations, evacuation shelters, open shops, cafes, relief supplies, local events).',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'Search keyword matching facility name, address, notes, status, or tags',
        },
        area: {
          type: 'string',
          description:
            'Filter by area or district name (e.g. "熊本市中央区", "東区")',
        },
        category: {
          type: 'string',
          description:
            'Category ID (e.g. "water", "shelter", "cafe", "store", "general")',
        },
        status: {
          type: 'string',
          description:
            'Status code: "available", "crowded", "few", "closed", or "unknown"',
          enum: ['available', 'crowded', 'few', 'closed', 'unknown'],
        },
        tag: {
          type: 'string',
          description:
            'Filter by community tag (e.g. "給水", "Wi-Fi", "充電", "営業中")',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of items to return (default 20, max 50)',
          default: 20,
        },
      },
    },
  },
  {
    name: 'get_post',
    description:
      'Get full details of a specific post by ID, including address, coordinates, attributes, community verification count, and status update history.',
    inputSchema: {
      type: 'object',
      properties: {
        id: {
          type: 'string',
          description: 'Unique post identifier',
        },
      },
      required: ['id'],
    },
  },
  {
    name: 'get_emergency_summary',
    description:
      'Get an aggregated situational summary of emergency and disaster support facilities (water stations, shelters, open stores) for an area or citywide.',
    inputSchema: {
      type: 'object',
      properties: {
        area: {
          type: 'string',
          description:
            'Target area / district to summarize (leave empty for citywide)',
        },
      },
    },
  },
  {
    name: 'get_categories',
    description:
      'List all available post categories in tossa with icons, colors, and scope (normal, disaster, or both).',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'get_vocabulary_tags',
    description:
      'List popular community vocabulary tags and their usage counts (e.g. #給水, #無料Wi-Fi, #炊き出し).',
    inputSchema: {
      type: 'object',
      properties: {
        limit: {
          type: 'integer',
          description: 'Number of tags to return (default 30)',
          default: 30,
        },
      },
    },
  },
  {
    name: 'get_areas',
    description:
      'List all unique areas / districts currently having reports in tossa.',
    inputSchema: {
      type: 'object',
      properties: {},
    },
  },
  {
    name: 'create_post',
    description:
      'Post new community living or disaster information. If authenticated via Bearer token, associated with your user account; otherwise registered as an agent submission.',
    inputSchema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description:
            'Facility name, shop name, or topic (e.g. "中央区役所 給水所")',
        },
        area: {
          type: 'string',
          description: 'District / Area (e.g. "熊本市中央区")',
        },
        category_id: {
          type: 'string',
          description:
            'Category ID (e.g. "water", "shelter", "cafe", "store", "general")',
          default: 'general',
        },
        address: {
          type: 'string',
          description: 'Street address or landmark description',
        },
        current_status: {
          type: 'string',
          description:
            'Status code: "available", "crowded", "few", "closed", or "unknown"',
          enum: ['available', 'crowded', 'few', 'closed', 'unknown'],
        },
        status_label: {
          type: 'string',
          description:
            'Japanese status text (e.g. "受付中", "給水中", "混雑", "営業中", "配布終了")',
        },
        note: {
          type: 'string',
          description:
            'Supplementary details (hours, remaining items, restrictions)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description:
            'List of community tags (e.g. ["給水", "ポリタンク持参"])',
        },
        lat: {
          type: 'number',
          description: 'Latitude (WGS84)',
        },
        lng: {
          type: 'number',
          description: 'Longitude (WGS84)',
        },
        source_url: {
          type: 'string',
          description:
            'Official source URL (local government, official X, news)',
        },
        url: {
          type: 'string',
          description: 'Related link or website URL',
        },
      },
      required: ['title', 'area', 'current_status', 'status_label'],
    },
  },
  {
    name: 'update_status',
    description:
      'Report or update the operational status of an existing facility or place in tossa (e.g. mark water station as out of water, or shelter as full).',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID to update',
        },
        status: {
          type: 'string',
          description:
            'Status code: "available", "crowded", "few", "closed", or "unknown"',
          enum: ['available', 'crowded', 'few', 'closed', 'unknown'],
        },
        status_label: {
          type: 'string',
          description:
            'Japanese status text (e.g. "配布中", "混雑中", "残りわずか", "受付終了")',
        },
        note: {
          type: 'string',
          description: 'Explanation or current situation details',
        },
      },
      required: ['post_id', 'status', 'status_label'],
    },
  },
  {
    name: 'verify_post',
    description:
      'Confirm or vouch that the information at this location is currently accurate and verified on-site.',
    inputSchema: {
      type: 'object',
      properties: {
        post_id: {
          type: 'string',
          description: 'Post ID to verify',
        },
      },
      required: ['post_id'],
    },
  },
];

const MCP_RESOURCES = [
  {
    uri: 'tossa://posts/recent',
    name: 'Recent Posts',
    description:
      'Recently updated community living and disaster information in tossa (JSON)',
    mimeType: 'application/json',
  },
  {
    uri: 'tossa://emergency',
    name: 'Emergency Status Summary',
    description:
      'Current status of emergency facilities, water supply points, and shelters (JSON)',
    mimeType: 'application/json',
  },
  {
    uri: 'tossa://categories',
    name: 'Categories',
    description: 'List of all post categories in tossa (JSON)',
    mimeType: 'application/json',
  },
  {
    uri: 'tossa://vocabulary',
    name: 'Vocabulary Tags',
    description: 'Spontaneously emerging community tags in tossa (JSON)',
    mimeType: 'application/json',
  },
];

const MCP_PROMPTS = [
  {
    name: 'tossa_disaster_briefing',
    description:
      'Generate an actionable emergency briefing for citizens based on real-time tossa disaster reports.',
    arguments: [
      {
        name: 'area',
        description:
          'Target district or municipality to report on (e.g. 熊本市中央区)',
        required: false,
      },
    ],
  },
  {
    name: 'tossa_find_supplies',
    description:
      'Find the nearest and most reliable relief supplies (water, food, power/battery charging, Wi-Fi) or open shops.',
    arguments: [
      {
        name: 'supplies',
        description:
          'Needed supplies or facilities (e.g. 水, おむつ, 電源, 食料)',
        required: true,
      },
      {
        name: 'area',
        description: 'Target area or district',
        required: false,
      },
    ],
  },
];

// ---------------- Tool Handlers ----------------

async function executeTool(
  name: string,
  args: any,
  env: Bindings,
  authUser: SessionPayload | null,
  agentId: string,
  ipHash: string
): Promise<{ text: string; isError?: boolean }> {
  try {
    switch (name) {
      case 'search_posts': {
        const limit = Math.min(Math.max(Number(args.limit) || 20, 1), 50);
        const result = await getPosts(env.DB, {
          search: args.query,
          area: args.area,
          categoryId: args.category,
          status: args.status,
          tag: args.tag,
          limit,
        });

        const formatted = result.posts.map((p) => ({
          id: p.id,
          title: p.title,
          area: p.area,
          address: p.address,
          status: p.current_status,
          status_label: p.status_label,
          category: p.category_id,
          note: p.note,
          tags: p.tags,
          is_verified: p.is_verified === 1,
          verification_count: p.verification_count,
          updated_at: p.updated_at,
          url: `${publicOrigin(env)}/#post-${p.id}`,
        }));

        return {
          text: JSON.stringify(
            {
              total: result.total,
              count: formatted.length,
              posts: formatted,
            },
            null,
            2
          ),
        };
      }

      case 'get_post': {
        if (!args.id) throw new Error('Parameter "id" is required');
        const post = await getPostById(env.DB, args.id);
        if (!post) {
          return {
            text: JSON.stringify({ error: 'Post not found', id: args.id }),
            isError: true,
          };
        }
        const updates = await getStatusUpdatesByPostId(env.DB, args.id);
        return {
          text: JSON.stringify(
            {
              post: {
                ...post,
                is_verified: post.is_verified === 1,
                url: `${publicOrigin(env)}/#post-${post.id}`,
              },
              status_history: updates,
            },
            null,
            2
          ),
        };
      }

      case 'get_emergency_summary': {
        const areaFilter = args.area?.trim();
        const postsRes = await getPosts(env.DB, {
          area: areaFilter || undefined,
          limit: 100,
        });

        const disasterPosts = postsRes.posts.filter(
          (p) =>
            p.category_id === 'water' ||
            p.category_id === 'shelter' ||
            p.category_id === 'supplies' ||
            p.tags.includes('給水') ||
            p.tags.includes('避難所') ||
            p.tags.includes('支援物資')
        );

        const statusCounts: Record<string, number> = {
          available: 0,
          crowded: 0,
          few: 0,
          closed: 0,
          unknown: 0,
        };

        for (const p of disasterPosts) {
          statusCounts[p.current_status] =
            (statusCounts[p.current_status] || 0) + 1;
        }

        const summary = {
          target_area: areaFilter || '全体（全地区）',
          disaster_facilities_total: disasterPosts.length,
          status_breakdown: {
            available_利用可能: statusCounts.available,
            crowded_混雑: statusCounts.crowded,
            low_stock_残りわずか: statusCounts.few,
            closed_終了休止: statusCounts.closed,
            unknown_確認中: statusCounts.unknown,
          },
          facilities: disasterPosts.map((p) => ({
            id: p.id,
            title: p.title,
            area: p.area,
            address: p.address,
            status: p.current_status,
            status_label: p.status_label,
            note: p.note,
            updated_at: p.updated_at,
          })),
        };

        return {
          text: JSON.stringify(summary, null, 2),
        };
      }

      case 'get_categories': {
        const categories = await getCategories(env.DB);
        return {
          text: JSON.stringify(categories, null, 2),
        };
      }

      case 'get_vocabulary_tags': {
        const limit = Number(args.limit) || 30;
        const tags = await getVocabularyTags(env.DB, limit);
        return {
          text: JSON.stringify(tags, null, 2),
        };
      }

      case 'get_areas': {
        const res = await env.DB.prepare(
          "SELECT DISTINCT area FROM posts WHERE area IS NOT NULL AND area != '' ORDER BY area ASC"
        ).all<{ area: string }>();
        const areas = (res.results || []).map((r) => r.area);
        return {
          text: JSON.stringify({ count: areas.length, areas }, null, 2),
        };
      }

      case 'create_post': {
        if (
          !args.title ||
          !args.area ||
          !args.current_status ||
          !args.status_label
        ) {
          throw new Error(
            'Missing required fields: "title", "area", "current_status", "status_label"'
          );
        }

        const id = `post_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
        const isAdmin = authUser?.role === 'admin';
        const reporterName =
          authUser?.displayName ||
          authUser?.username ||
          `MCP Agent (${agentId.slice(0, 8)})`;

        await createPost(env.DB, {
          id,
          categoryId: args.category_id || 'general',
          title: args.title.trim(),
          area: args.area.trim(),
          address: args.address?.trim() || '',
          lat: typeof args.lat === 'number' ? args.lat : undefined,
          lng: typeof args.lng === 'number' ? args.lng : undefined,
          currentStatus: args.current_status,
          statusLabel: args.status_label.trim(),
          note: args.note?.trim() || '',
          url: args.url?.trim() || '',
          sourceUrl: args.source_url?.trim() || '',
          imageUrl: '',
          imageMeta: {},
          attributes: {},
          tags: Array.isArray(args.tags) ? args.tags : [],
          isVerified: isAdmin,
          authorId: authUser?.userId || null,
          authorCookieId: null,
          reporterName,
        });

        // If high importance or verified, broadcast push alert
        if (
          isAdmin ||
          args.category_id === 'water' ||
          args.category_id === 'shelter'
        ) {
          broadcastPushNotification(env, {
            title: `【${args.status_label}】${args.title}`,
            body: `${args.area}: ${args.note || '情報が更新されました'}`,
            url: `${publicOrigin(env)}/#post-${id}`,
            alertType:
              args.category_id === 'shelter' || args.category_id === 'water'
                ? 'evacuation'
                : 'status',
            area: args.area,
          }).catch((err) => console.warn('Push notification error:', err));
        }

        return {
          text: JSON.stringify(
            {
              success: true,
              message: '生活情報を投稿しました',
              post_id: id,
              is_verified: isAdmin,
              author: reporterName,
              url: `${publicOrigin(env)}/#post-${id}`,
            },
            null,
            2
          ),
        };
      }

      case 'update_status': {
        if (!args.post_id || !args.status || !args.status_label) {
          throw new Error(
            'Missing required fields: "post_id", "status", "status_label"'
          );
        }

        const existing = await getPostById(env.DB, args.post_id);
        if (!existing) {
          return {
            text: JSON.stringify({
              error: 'Post not found',
              post_id: args.post_id,
            }),
            isError: true,
          };
        }

        await updatePostStatus(
          env.DB,
          args.post_id,
          args.status,
          args.status_label,
          args.note || '',
          ipHash
        );

        return {
          text: JSON.stringify(
            {
              success: true,
              message: `「${existing.title}」の状況を「${args.status_label}」に更新しました`,
              post_id: args.post_id,
              status: args.status,
              status_label: args.status_label,
            },
            null,
            2
          ),
        };
      }

      case 'verify_post': {
        if (!args.post_id) throw new Error('Parameter "post_id" is required');
        const verif = await verifyPost(env.DB, args.post_id, ipHash);
        return {
          text: JSON.stringify(
            {
              success: true,
              message: '現地の最新情報として確認しました',
              post_id: args.post_id,
              current_verification_count: verif.verificationCount,
              last_verified_at: verif.lastVerifiedAt,
            },
            null,
            2
          ),
        };
      }

      default:
        return {
          text: `Unknown tool: "${name}"`,
          isError: true,
        };
    }
  } catch (err: any) {
    return {
      text: `Tool execution failed: ${err.message || String(err)}`,
      isError: true,
    };
  }
}

// ---------------- Resource Handlers ----------------

async function readResource(
  uri: string,
  env: Bindings
): Promise<{ uri: string; mimeType: string; text: string }> {
  switch (uri) {
    case 'tossa://posts/recent': {
      const res = await getPosts(env.DB, { limit: 30 });
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(res.posts, null, 2),
      };
    }
    case 'tossa://emergency': {
      const res = await getPosts(env.DB, { limit: 50 });
      const emergency = res.posts.filter(
        (p) =>
          p.category_id === 'water' ||
          p.category_id === 'shelter' ||
          p.category_id === 'supplies'
      );
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(emergency, null, 2),
      };
    }
    case 'tossa://categories': {
      const categories = await getCategories(env.DB);
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(categories, null, 2),
      };
    }
    case 'tossa://vocabulary': {
      const tags = await getVocabularyTags(env.DB, 50);
      return {
        uri,
        mimeType: 'application/json',
        text: JSON.stringify(tags, null, 2),
      };
    }
    default:
      throw new Error(`Resource not found: ${uri}`);
  }
}

// ---------------- Central JSON-RPC 2.0 Dispatcher ----------------

async function handleRpcMessage(
  msg: any,
  env: Bindings,
  authUser: SessionPayload | null,
  agentId: string,
  ipHash: string
): Promise<any> {
  if (!msg || typeof msg !== 'object') {
    return {
      jsonrpc: '2.0',
      id: null,
      error: { code: -32600, message: 'Invalid Request: expected JSON object' },
    };
  }

  const { jsonrpc, id, method, params } = msg;

  if (jsonrpc !== '2.0') {
    return {
      jsonrpc: '2.0',
      id: id ?? null,
      error: {
        code: -32600,
        message: 'Invalid Request: jsonrpc must be "2.0"',
      },
    };
  }

  switch (method) {
    case 'initialize': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: {
            tools: { listChanged: false },
            resources: { subscribe: false, listChanged: false },
            prompts: { listChanged: false },
          },
          serverInfo: {
            name: 'tossa',
            version: '0.1.0',
          },
          instructions:
            'tossa provides real-time community living and disaster information. Use "search_posts" to find supplies/facilities, "get_emergency_summary" for aggregated disaster situation reports, and "update_status" or "create_post" to keep information current.',
        },
      };
    }

    case 'notifications/initialized': {
      if (id !== undefined && id !== null) {
        return { jsonrpc: '2.0', id, result: {} };
      }
      return null; // Notification, no response
    }

    case 'ping': {
      return { jsonrpc: '2.0', id, result: {} };
    }

    case 'tools/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          tools: MCP_TOOLS,
        },
      };
    }

    case 'tools/call': {
      const toolName = params?.name;
      const toolArgs = params?.arguments || {};
      const execResult = await executeTool(
        toolName,
        toolArgs,
        env,
        authUser,
        agentId,
        ipHash
      );

      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [
            {
              type: 'text',
              text: execResult.text,
            },
          ],
          isError: execResult.isError || false,
        },
      };
    }

    case 'resources/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          resources: MCP_RESOURCES,
        },
      };
    }

    case 'resources/read': {
      const uri = params?.uri;
      try {
        const content = await readResource(uri, env);
        return {
          jsonrpc: '2.0',
          id,
          result: {
            contents: [content],
          },
        };
      } catch (err: any) {
        return {
          jsonrpc: '2.0',
          id,
          error: { code: -32002, message: err.message || 'Resource not found' },
        };
      }
    }

    case 'prompts/list': {
      return {
        jsonrpc: '2.0',
        id,
        result: {
          prompts: MCP_PROMPTS,
        },
      };
    }

    case 'prompts/get': {
      const promptName = params?.name;
      const promptArgs = params?.arguments || {};

      if (promptName === 'tossa_disaster_briefing') {
        const areaText = promptArgs.area
          ? `対象エリア: ${promptArgs.area}`
          : '対象エリア: 全域';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Emergency situation briefing for tossa community',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `tossa の生活情報板から現在の災害・避難所・給水所・物資状況（${areaText}）を「get_emergency_summary」ツールで取得し、住民や利用者が直ちに行動できるよう、要点をまとめた最新の緊急状況ブリーフィングを作成してください。`,
                },
              },
            ],
          },
        };
      }

      if (promptName === 'tossa_find_supplies') {
        const supplies = promptArgs.supplies || '必要な物資';
        const areaText = promptArgs.area ? `（${promptArgs.area}）` : '';
        return {
          jsonrpc: '2.0',
          id,
          result: {
            description: 'Find supplies guidance',
            messages: [
              {
                role: 'user',
                content: {
                  type: 'text',
                  text: `tossa で「${supplies}」${areaText} を「search_posts」ツールで検索し、現在利用可能（available / 営業中 / 配布中）な場所、混雑状況、および利用時の注意点を整理して教えてください。`,
                },
              },
            ],
          },
        };
      }

      return {
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Prompt not found: ${promptName}` },
      };
    }

    default: {
      return {
        jsonrpc: '2.0',
        id: id ?? null,
        error: { code: -32601, message: `Method not found: ${method}` },
      };
    }
  }
}

// ---------------- Route Handlers ----------------

/** Extract optional session from Authorization header */
async function getAuthUser(c: any): Promise<SessionPayload | null> {
  const authHeader = c.req.header('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return null;
  return await verifySessionToken(token, c.env.JWT_SECRET);
}

/** Compute anonymous SHA-256 IP hash for abuse protection */
async function computeIpHash(ip: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`tossa:mcp:${ip}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

// 1. HTTP JSON-RPC 2.0 Endpoint (POST /mcp or POST /api/mcp)
mcpRoute.post('/', async (c) => {
  const authUser = await getAuthUser(c);
  const clientIp = getClientIp(c.req.raw);
  const ipHash = await computeIpHash(clientIp);
  const agentId =
    c.req.header('x-agent-id') ||
    c.req.header('x-device-id') ||
    `agent_${crypto.randomUUID().slice(0, 8)}`;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error: invalid JSON' },
      },
      400
    );
  }

  // Handle batch requests
  if (Array.isArray(body)) {
    const responses = await Promise.all(
      body.map((item) =>
        handleRpcMessage(item, c.env, authUser, agentId, ipHash)
      )
    );
    const filtered = responses.filter((r) => r !== null);
    return c.json(filtered);
  }

  // Single request
  const response = await handleRpcMessage(
    body,
    c.env,
    authUser,
    agentId,
    ipHash
  );
  if (response === null) {
    return new Response(null, { status: 204 });
  }

  return c.json(response);
});

// 2. Server-Sent Events (SSE) Transport (GET /mcp/sse)
mcpRoute.get('/sse', async (c) => {
  const sessionId = `mcp_${crypto.randomUUID()}`;
  const origin = new URL(c.req.url).origin;
  const messagesEndpoint = `${origin}/mcp/messages?sessionId=${sessionId}`;

  return streamSSE(c, async (stream) => {
    // 1. Send endpoint event required by MCP SSE specification
    await stream.writeSSE({
      event: 'endpoint',
      data: messagesEndpoint,
    });

    // 2. Periodic keepalive ping to maintain connection
    const interval = setInterval(async () => {
      try {
        await stream.writeSSE({
          event: 'ping',
          data: new Date().toISOString(),
        });
      } catch {
        clearInterval(interval);
      }
    }, 25000);

    // Keep stream alive until client disconnects
    await new Promise((resolve) => {
      stream.onAbort(() => {
        clearInterval(interval);
        resolve(null);
      });
    });
  });
});

// 3. SSE Messages Handler (POST /mcp/messages)
mcpRoute.post('/messages', async (c) => {
  const authUser = await getAuthUser(c);
  const clientIp = getClientIp(c.req.raw);
  const ipHash = await computeIpHash(clientIp);
  const agentId =
    c.req.header('x-agent-id') ||
    c.req.header('x-device-id') ||
    `agent_${crypto.randomUUID().slice(0, 8)}`;

  let body: any;
  try {
    body = await c.req.json();
  } catch {
    return c.json(
      {
        jsonrpc: '2.0',
        id: null,
        error: { code: -32700, message: 'Parse error' },
      },
      400
    );
  }

  const response = await handleRpcMessage(
    body,
    c.env,
    authUser,
    agentId,
    ipHash
  );
  if (response === null) {
    return new Response(null, { status: 204 });
  }

  return c.json(response);
});

// 4. Developer / Browser Overview (GET /mcp)
mcpRoute.get('/', (c) => {
  const isHtml = c.req.header('Accept')?.includes('text/html');
  const origin = new URL(c.req.url).origin;

  if (!isHtml) {
    return c.json({
      name: 'tossa-mcp',
      version: '0.1.0',
      description:
        'tossa (咄嗟) Model Context Protocol (MCP) Server for AI Assistants',
      transports: {
        http_post: `${origin}/mcp`,
        sse: `${origin}/mcp/sse`,
        messages: `${origin}/mcp/messages`,
      },
      tools_count: MCP_TOOLS.length,
      resources_count: MCP_RESOURCES.length,
      prompts_count: MCP_PROMPTS.length,
    });
  }

  const html = `<!DOCTYPE html>
<html lang="ja">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>tossa MCP Server (Model Context Protocol)</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; line-height: 1.6; max-width: 800px; margin: 40px auto; padding: 0 20px; color: #1e293b; background: #f8fafc; }
    h1 { color: #0f172a; display: flex; align-items: center; gap: 8px; font-size: 1.6rem; }
    .badge { background: #dbeafe; color: #1e40af; padding: 3px 8px; border-radius: 9999px; font-size: 0.75rem; font-weight: bold; }
    pre { background: #0f172a; color: #f8fafc; padding: 16px; border-radius: 10px; overflow-x: auto; font-size: 0.85rem; }
    code { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; }
    .card { background: white; border: 1px solid #e2e8f0; border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 1px 3px rgba(0,0,0,0.05); }
    ul { padding-left: 20px; }
    li { margin-bottom: 6px; }
  </style>
</head>
<body>
  <h1>tossa MCP Server <span class="badge">Model Context Protocol</span></h1>
  <p>tossa（咄嗟）の生活情報・災害避難所・給水所・物資状況を、AIエージェント（Claude Desktop、Cursor、Antigravity、各種LLM）からリアルタイムに操作・検索できる MCP エンドポイントです。</p>

  <div class="card">
    <h2>1. 接続設定（Claude Desktop / Cursor）</h2>
    <p><code>claude_desktop_config.json</code> または Cursor MCP 設定に追加してください：</p>
    <pre><code>{
  "mcpServers": {
    "tossa": {
      "url": "${origin}/mcp"
    }
  }
}</code></pre>
    <p><small>※ 認証トークンをお持ちの場合は <code>"headers": { "Authorization": "Bearer tossa_pat_..." }</code> を指定すると、アカウント連携投稿や管理者操作が可能になります。</small></p>
  </div>

  <div class="card">
    <h2>2. 提供ツール（Tools）</h2>
    <ul>
      <li><code>search_posts</code>: 生活情報・給水所・避難所の検索（キーワード、エリア、カテゴリ、タグ）</li>
      <li><code>get_post</code>: 投稿の詳細とステータス更新履歴の取得</li>
      <li><code>get_emergency_summary</code>: 災害・給水所・避難所のアグリゲーション要約</li>
      <li><code>get_categories</code>: カテゴリ一覧の取得</li>
      <li><code>get_vocabulary_tags</code>: 自発的成長タグ一覧の取得</li>
      <li><code>get_areas</code>: 登録エリア一覧の取得</li>
      <li><code>create_post</code>: 生活情報・避難所情報の新規投稿</li>
      <li><code>update_status</code>: 現地ステータスの更新報告</li>
      <li><code>verify_post</code>: 現地確認済みのコミュニティ投票</li>
    </ul>
  </div>

  <div class="card">
    <h2>3. エンドポイント仕様</h2>
    <ul>
      <li><strong>Stateless HTTP POST (推奨)</strong>: <code>${origin}/mcp</code> (JSON-RPC 2.0)</li>
      <li><strong>Server-Sent Events (SSE)</strong>: <code>${origin}/mcp/sse</code></li>
      <li><strong>SSE Message POST</strong>: <code>${origin}/mcp/messages</code></li>
    </ul>
  </div>
</body>
</html>`;

  return c.html(html);
});
