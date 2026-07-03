function generateK6Script(endpoints, options) {
    const { peak = false, authToken = null } = options || {};
    const {
        vus = 1,
        rampUp = '10s',
        duration = '30s',
        statusValidation = 'SEM STATUS',
        responseTimeLimit = 1000,
        disableResponseValidation = false,
    } = options;

    let checks = '';
    if (statusValidation !== 'SEM STATUS') {
        checks += `check(res, { 'status é ${statusValidation}': (r) => r.status === ${statusValidation} });\n`;
    }
    if (!disableResponseValidation) {
        checks += `check(res, { 'tempo de resposta < ${responseTimeLimit}ms': (r) => r.timings.duration < ${responseTimeLimit} });\n`;
    }

    const requests = endpoints.map(ep => {
        const headers = Object.assign({}, ep.headers);
        if (authToken && !headers['Authorization'] && !headers['authorization']) {
            headers['Authorization'] = `Bearer ${authToken}`;
        }

        // JSON.stringify garante escape completo de caracteres especiais,
        // evitando que URLs/bodies/métodos quebrem o contexto de string JS.
        const safeUrl = JSON.stringify(ep.url);
        const safeMethod = JSON.stringify(ep.method);
        const safeHeaders = JSON.stringify(headers);
        const method = ep.method.toLowerCase();

        // k6 http.get/del: (url, params) — sem argumento body
        // k6 http.post/put/patch: (url, body, params)
        const noBodyMethods = ['get', 'head'];
        const callArgs = noBodyMethods.includes(method)
            ? `(${safeUrl}, { headers: ${safeHeaders} })`
            : `(${safeUrl}, ${ep.body ? JSON.stringify(ep.body) : 'null'}, { headers: ${safeHeaders} })`;

        // k6 usa http.del() para DELETE (delete é palavra reservada em JS)
        const httpCall = method === 'delete' ? `http.del${callArgs}` : `http.${method}${callArgs}`;

        return `
    group(${safeUrl}, () => {
      let res = ${httpCall};
      ${checks}
      console.log('RESULT:' + JSON.stringify({
        endpoint: ${safeUrl},
        method: ${safeMethod},
        status: res.status,
        duration: res.timings.duration
      }));
    });`;
    }).join('\n');

    let stages = [];
    if (peak) {
        // pico: sobe rápido, mantém, cai rápido — bom pra achar o ponto de ruptura
        stages = [
            { duration: rampUp, target: vus },
            { duration, target: vus },
            { duration: '10s', target: 0 },
        ];
    } else {
        stages = [
            { duration: rampUp, target: vus },
            { duration, target: vus },
        ];
    }

    return `
import http from 'k6/http';
import { check, group } from 'k6';

export const options = {
  stages: ${JSON.stringify(stages)},
};

export default function () {
  ${requests}
}
`;
}

module.exports = { generateK6Script };
