function parseCurl(input) {
  input = input.trim();

  if (input.startsWith('curl')) {
    const method = /-X\s+['"]?(\w+)['"]?/i.exec(input)?.[1]?.toUpperCase() || null;

    // A URL pode vir em qualquer posição do comando (antes ou depois de -X, -H, -d...).
    // Busca por uma URL http(s) em qualquer lugar da string, em vez de assumir que é
    // sempre o primeiro token depois de "curl" (isso quebrava com "curl -X POST URL").
    const urlMatch = /['"]?(https?:\/\/[^\s'"]+)['"]?/i.exec(input);
    const url = urlMatch ? urlMatch[1] : '';

    const headers = {};
    const headerMatches = input.match(/-H\s+['"]([^'"]+)['"]/g);
    if (headerMatches) {
      headerMatches.forEach(h => {
        const content = h.replace(/^-H\s+['"]|['"]$/g, '');
        const sepIdx = content.indexOf(':');
        if (sepIdx === -1) return;
        const key = content.slice(0, sepIdx).trim();
        const value = content.slice(sepIdx + 1).trim();
        headers[key] = value;
      });
    }

    const dataMatch = /(?:--data(?:-raw)?|-d)\s+['"]([\s\S]+?)['"](?:\s|$)/i.exec(input);
    const body = dataMatch ? dataMatch[1] : '';

    // curl assume POST automaticamente quando há -d/--data, mesmo sem -X explícito
    const resolvedMethod = method || (body ? 'POST' : 'GET');

    return { url, method: resolvedMethod, headers, body };
  }

  // Formato "METHOD URL" (ex: "GET https://api.example.com/path")
  const methodUrlMatch = /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+(https?:\/\/\S+)$/i.exec(input);
  if (methodUrlMatch) {
    return { url: methodUrlMatch[2], method: methodUrlMatch[1].toUpperCase(), headers: {}, body: '' };
  }

  // Só uma URL, sem método explícito — assume GET
  return { url: input, method: 'GET', headers: {}, body: '' };
}

module.exports = { parseCurl };
