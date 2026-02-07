/**
 * Cluster Service - Sistema de Coordenação entre Dispositivos
 * 
 * Gerencia eleição de líder, failover e sincronização de dados
 * entre Oracle, PC e Celular.
 * 
 * Hierarquia: Oracle (1) > PC (2) > Celular (3)
 */

const fs = require('fs');
const path = require('path');
const { execSync, exec } = require('child_process');

const CLUSTER_FILE = path.join(__dirname, 'cluster.json');
const HEARTBEAT_INTERVAL = 10000; // 10 segundos
const DEAD_THRESHOLD = 180000; // 3 minutos sem heartbeat = morto (precisa ser > sync interval do master)
const IDLE_TAKEOVER_TIME = 10 * 60 * 1000; // 10 minutos para assumir de dispositivo de menor prioridade

// Intervalos de sync baseados na prioridade (mais alto = menos frequente)
const SYNC_INTERVALS = {
    1: 2 * 60 * 1000,   // Oracle: 2 min
    2: 3 * 60 * 1000,   // PC: 3 min
    3: 10 * 60 * 1000,  // Celular: 10 min
    99: 5 * 60 * 1000   // Default: 5 min
};

class ClusterService {
    constructor() {
        this.deviceId = process.env.DEVICE_ID || 'unknown';
        this.priority = parseInt(process.env.DEVICE_PRIORITY) || 99;
        this.isMaster = false;
        this.lastMessageTime = null;
        this.heartbeatTimer = null;
        this.syncTimer = null;
        this.checkTimer = null;
        this.lastDataVersion = 0; // Para detectar mudanças remotas
        this.hasLocalChanges = false; // Flag para detectar mudanças locais
        this.onBecomeMaster = null; // Callback chamado quando vira master

        // Calcula intervalo de sync baseado na prioridade
        this.syncInterval = SYNC_INTERVALS[this.priority] || SYNC_INTERVALS[99];

        console.log(`[Cluster] Inicializando dispositivo: ${this.deviceId} (prioridade: ${this.priority}, sync: ${this.syncInterval / 1000}s)`);
    }

    /**
     * Carrega dados do cluster
     */
    loadCluster() {
        try {
            delete require.cache[require.resolve('./cluster.json')];
            const data = fs.readFileSync(CLUSTER_FILE, 'utf-8');
            return JSON.parse(data);
        } catch (err) {
            return {
                master: null,
                devices: {},
                dataVersion: 1,
                lastSync: null
            };
        }
    }

    /**
     * Salva dados do cluster
     */
    saveCluster(cluster) {
        fs.writeFileSync(CLUSTER_FILE, JSON.stringify(cluster, null, 2), 'utf-8');
    }

    /**
     * Registra este dispositivo no cluster
     */
    registerDevice() {
        const cluster = this.loadCluster();
        const now = new Date().toISOString();

        cluster.devices[this.deviceId] = {
            priority: this.priority,
            status: 'starting',
            lastSeen: now,
            lastHeartbeat: now
        };

        this.saveCluster(cluster);
        console.log(`[Cluster] Dispositivo ${this.deviceId} registrado`);
    }

    /**
     * Envia heartbeat para indicar que está vivo
     */
    sendHeartbeat() {
        const cluster = this.loadCluster();
        const now = new Date().toISOString();

        if (cluster.devices[this.deviceId]) {
            cluster.devices[this.deviceId].lastHeartbeat = now;
            cluster.devices[this.deviceId].lastSeen = now;
            cluster.devices[this.deviceId].status = this.isMaster ? 'master' : 'standby';

            if (this.isMaster && this.lastMessageTime) {
                cluster.master.lastMessageAt = this.lastMessageTime;
            }
        }

        this.saveCluster(cluster);
    }

    /**
     * Verifica se um dispositivo está vivo (heartbeat recente)
     */
    isDeviceAlive(device) {
        if (!device || !device.lastHeartbeat) return false;
        const lastBeat = new Date(device.lastHeartbeat).getTime();
        return (Date.now() - lastBeat) < DEAD_THRESHOLD;
    }

    /**
     * Verifica se o master atual está ocioso (sem mensagens há muito tempo)
     */
    isMasterIdle(cluster) {
        if (!cluster.master || !cluster.master.lastMessageAt) return true;
        const lastMsg = new Date(cluster.master.lastMessageAt).getTime();
        return (Date.now() - lastMsg) > IDLE_TAKEOVER_TIME;
    }

    /**
     * Encontra o dispositivo com maior prioridade online
     */
    findHighestPriorityOnline(cluster) {
        let highest = null;
        let highestPriority = 999;

        for (const [id, device] of Object.entries(cluster.devices)) {
            if (this.isDeviceAlive(device) && device.priority < highestPriority) {
                highest = id;
                highestPriority = device.priority;
            }
        }

        return highest;
    }

    /**
     * Torna-se o master (líder)
     */
    becomeMaster() {
        const cluster = this.loadCluster();
        const now = new Date().toISOString();

        // Atualiza antigo master para standby
        if (cluster.master && cluster.devices[cluster.master.device]) {
            cluster.devices[cluster.master.device].status = 'standby';
        }

        cluster.master = {
            device: this.deviceId,
            startedAt: now,
            lastHeartbeat: now,
            lastMessageAt: null
        };

        cluster.devices[this.deviceId].status = 'master';

        this.saveCluster(cluster);

        const wasMaster = this.isMaster;
        this.isMaster = true;

        console.log(`[Cluster] ⭐ ${this.deviceId} ASSUMIU como MASTER!`);

        // IMPORTANTE: Faz sync imediato para o GitHub para que outros dispositivos vejam
        console.log('[Cluster] Sincronizando status de master para GitHub...');
        this.syncToGit();

        // Dispara callback se virou master agora (e não era antes)
        if (!wasMaster && this.onBecomeMaster) {
            console.log('[Cluster] Disparando callback onBecomeMaster...');
            this.onBecomeMaster();
        }
    }

    /**
     * Entra em modo standby
     */
    becomeStandby() {
        const cluster = this.loadCluster();

        if (cluster.devices[this.deviceId]) {
            cluster.devices[this.deviceId].status = 'standby';
        }

        this.saveCluster(cluster);
        this.isMaster = false;

        console.log(`[Cluster] ${this.deviceId} em modo STANDBY`);
    }

    /**
     * Sincroniza dados do GitHub (apenas se houver mudanças remotas)
     */
    async syncFromGit() {
        return new Promise((resolve) => {
            // Primeiro verifica se há mudanças remotas
            exec('git fetch origin main && git diff --quiet HEAD origin/main', { cwd: path.join(__dirname, '..') }, (error) => {
                if (!error) {
                    // Sem mudanças remotas
                    resolve(true);
                    return;
                }

                // Há mudanças, faz pull
                console.log('[Cluster] Detectadas mudanças remotas, sincronizando...');
                exec('git pull origin main', { cwd: path.join(__dirname, '..') }, (pullError, stdout) => {
                    if (pullError) {
                        console.error('[Cluster] Erro no git pull:', pullError.message);
                        resolve(false);
                        return;
                    }
                    console.log('[Cluster] Dados sincronizados');
                    resolve(true);
                });
            });
        });
    }

    /**
     * Envia dados para o GitHub (apenas master, apenas se houver mudanças)
     * Compatível com Windows e Linux
     */
    async syncToGit() {
        if (!this.isMaster) return true;

        const projectRoot = path.join(__dirname, '..');

        return new Promise((resolve) => {
            // Primeiro verifica se há mudanças locais
            exec('git status --porcelain shared/', { cwd: projectRoot }, (error, stdout) => {
                if (!stdout || stdout.trim() === '') {
                    // Sem mudanças locais
                    resolve(true);
                    return;
                }

                // Incrementa versão de dados
                const cluster = this.loadCluster();
                cluster.dataVersion = (cluster.dataVersion || 0) + 1;
                cluster.lastSync = new Date().toISOString();
                this.saveCluster(cluster);

                console.log('[Cluster] Enviando mudanças para GitHub...');

                // Passo 1: git add shared/*.json
                exec('git add shared/*.json', { cwd: projectRoot }, (addErr) => {
                    if (addErr) {
                        console.error('[Cluster] Erro no git add:', addErr.message);
                        resolve(false);
                        return;
                    }

                    // Passo 2: git commit (pode falhar se não houver nada staged)
                    const commitMsg = `auto-sync: data v${cluster.dataVersion}`;
                    exec(`git commit -m "${commitMsg}"`, { cwd: projectRoot }, (commitErr) => {
                        // Ignora erro de "nothing to commit"
                        if (commitErr && !commitErr.message.includes('nothing to commit')) {
                            console.error('[Cluster] Erro no git commit:', commitErr.message);
                            resolve(false);
                            return;
                        }

                        // Passo 3: git push
                        exec('git push origin main', { cwd: projectRoot }, (pushErr) => {
                            if (pushErr) {
                                console.error('[Cluster] Erro no git push:', pushErr.message);
                                resolve(false);
                                return;
                            }
                            console.log(`[Cluster] Dados v${cluster.dataVersion} enviados`);
                            resolve(true);
                        });
                    });
                });
            });
        });
    }

    /**
     * Registra que uma mensagem foi respondida (atualiza tempo de atividade)
     */
    recordMessageActivity() {
        this.lastMessageTime = new Date().toISOString();

        const cluster = this.loadCluster();
        if (cluster.master && cluster.master.device === this.deviceId) {
            cluster.master.lastMessageAt = this.lastMessageTime;
            this.saveCluster(cluster);
        }
    }

    /**
     * Verifica se pode responder mensagens
     */
    canRespond() {
        return this.isMaster;
    }

    /**
     * Verifica status do cluster e decide ação
     */
    checkClusterStatus() {
        const cluster = this.loadCluster();

        // Se não há master
        if (!cluster.master) {
            const highest = this.findHighestPriorityOnline(cluster);
            if (highest === this.deviceId) {
                console.log('[Cluster] Nenhum master - assumindo controle');
                this.becomeMaster();
            }
            return;
        }

        const currentMaster = cluster.master.device;
        const masterDevice = cluster.devices[currentMaster];

        // Master está morto?
        if (!this.isDeviceAlive(masterDevice)) {
            console.log(`[Cluster] Master ${currentMaster} está morto!`);

            const highest = this.findHighestPriorityOnline(cluster);
            if (highest === this.deviceId) {
                console.log('[Cluster] Eu sou o próximo na hierarquia - assumindo!');
                this.syncFromGit().then(() => {
                    this.becomeMaster();
                });
            }
            return;
        }

        // Eu sou o master atual?
        if (currentMaster === this.deviceId) {
            this.isMaster = true;
            return;
        }

        // Eu tenho prioridade maior que o master atual?
        if (this.priority < masterDevice.priority) {
            // IMPORTANTE: Mesmo com maior prioridade, devo aguardar master ficar ocioso
            // Isso evita conflitos de conexão quando o dispositivo de maior prioridade retorna
            if (this.isMasterIdle(cluster)) {
                console.log(`[Cluster] Master ${currentMaster} ocioso há +10min - assumindo controle`);
                this.syncFromGit().then(() => {
                    this.becomeMaster();
                });
            } else {
                // Master ainda está ativo - aguardar pacientemente
                console.log(`[Cluster] Master ${currentMaster} ainda ativo - aguardando ficar ocioso...`);
                this.becomeStandby();
            }
        } else {
            // Minha prioridade é menor - fico em standby
            this.becomeStandby();
        }
    }

    /**
     * Inicia o serviço de cluster
     */
    async start() {
        console.log('[Cluster] Iniciando serviço de cluster...');

        // IMPORTANTE: Sincroniza dados PRIMEIRO para saber quem é master
        await this.syncFromGit();

        // Depois registra este dispositivo (preserva o master atual se houver)
        this.registerDevice();

        // Verifica status inicial
        this.checkClusterStatus();

        // Inicia heartbeat
        this.heartbeatTimer = setInterval(() => {
            this.sendHeartbeat();
        }, HEARTBEAT_INTERVAL);

        // Inicia verificação periódica do cluster
        this.checkTimer = setInterval(() => {
            this.checkClusterStatus();
        }, HEARTBEAT_INTERVAL * 3); // A cada 30s

        // Inicia sync periódico (baseado na prioridade do dispositivo)
        this.syncTimer = setInterval(async () => {
            if (this.isMaster) {
                await this.syncToGit();
            } else {
                await this.syncFromGit();
            }
        }, this.syncInterval);

        console.log('[Cluster] Serviço iniciado');
        return this.isMaster;
    }

    /**
     * Para o serviço de cluster
     */
    stop() {
        console.log('[Cluster] Parando serviço...');

        if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
        if (this.checkTimer) clearInterval(this.checkTimer);
        if (this.syncTimer) clearInterval(this.syncTimer);

        // Atualiza status para offline
        const cluster = this.loadCluster();
        if (cluster.devices[this.deviceId]) {
            cluster.devices[this.deviceId].status = 'offline';
        }

        // Se era master, limpa
        if (this.isMaster && cluster.master?.device === this.deviceId) {
            cluster.master = null;
        }

        this.saveCluster(cluster);

        // Sync final
        if (this.isMaster) {
            try {
                execSync('git add shared/*.json && git commit -m "auto-sync: shutdown" && git push origin main', {
                    cwd: path.join(__dirname, '..'),
                    stdio: 'ignore'
                });
            } catch (e) {
                // Ignora erros no shutdown
            }
        }

        console.log('[Cluster] Serviço parado');
    }

    /**
     * Retorna status atual do cluster
     */
    getStatus() {
        const cluster = this.loadCluster();
        return {
            myDevice: this.deviceId,
            myPriority: this.priority,
            isMaster: this.isMaster,
            currentMaster: cluster.master?.device || 'none',
            devices: cluster.devices
        };
    }
}

module.exports = new ClusterService();
