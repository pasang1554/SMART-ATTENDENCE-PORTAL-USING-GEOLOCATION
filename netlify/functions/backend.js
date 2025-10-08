exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers: cors() };
  }

  try {
    const { method, path } = route(event);

    // Health check endpoint
    if (method === 'GET' && path === '/health') {
      return json(200, { status: 'ok', timestamp: new Date().toISOString() });
    }

    // Default response for unmatched routes
    return json(404, { message: 'Not found' });
  } catch (err) {
    return json(500, { message: err.message || 'Server error' });
  }
};

function cors() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  };
}

function json(statusCode, data) {
  return { 
    statusCode, 
    headers: { 
      'Content-Type': 'application/json', 
      ...cors() 
    }, 
    body: JSON.stringify(data) 
  };
}

function route(event) {
  const url = new URL(event.rawUrl || `https://x${event.path}${event.queryStringParameters ? '?' : ''}`);
  const method = event.httpMethod;
  return { 
    method, 
    path: url.pathname.replace(/^\/\.netlify\/functions\/backend/, '') || '/' 
  };
}
