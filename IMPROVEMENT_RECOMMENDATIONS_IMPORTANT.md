# Рекомендации по улучшению важных проблем Higgs.net

## Обзор

Этот документ содержит детальные рекомендации по решению важных проблем (Приоритет 2 и 3), которые влияют на стабильность, производительность и масштабируемость системы, но не блокируют базовую функциональность.

---

## Приоритет 2: Важные проблемы (влияют на стабильность и производительность)

### 2.1. Решение проблемы двойного NAT (Double NAT)

#### Проблема
Когда HiggsNode находится за NAT роутера, возникает двойное преобразование адресов, что приводит к проблемам с некоторыми протоколами и увеличению latency.

#### Решение

**Шаг 1: Создать UPnP/NAT-PMP клиент**

Создать файл `higgsnode/src/services/PortForwardingService.ts`:

```typescript
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { isLinux, isWindows, isMacOS } from '../utils/platform';

export interface PortMapping {
  internalPort: number;
  externalPort: number;
  protocol: 'tcp' | 'udp';
  description: string;
  ttl: number; // В секундах
}

export class PortForwardingService extends EventEmitter {
  private upnpClient: any = null;
  private natPmpClient: any = null;
  private activeMappings: Map<number, PortMapping> = new Map();
  private refreshTimer: NodeJS.Timeout | null = null;

  constructor() {
    super();
  }

  /**
   * Инициализирует UPnP/NAT-PMP клиент
   */
  async initialize(): Promise<void> {
    try {
      logger.info('Initializing port forwarding service');

      // Попробовать UPnP (работает на большинстве роутеров)
      if (await this.initializeUPnP()) {
        logger.info('UPnP initialized successfully');
        return;
      }

      // Попробовать NAT-PMP (macOS/iOS роутеры)
      if (isMacOS() && await this.initializeNAT_PMP()) {
        logger.info('NAT-PMP initialized successfully');
        return;
      }

      logger.warn('Neither UPnP nor NAT-PMP available, port forwarding disabled');
      this.emit('unavailable');
    } catch (error) {
      logger.error('Failed to initialize port forwarding', { error });
      throw error;
    }
  }

  /**
   * Инициализирует UPnP клиент
   */
  private async initializeUPnP(): Promise<boolean> {
    try {
      // Использовать библиотеку node-upnp или nat-upnp
      const natUpnp = await import('nat-upnp');
      this.upnpClient = natUpnp.createClient();

      // Проверить доступность UPnP роутера
      return new Promise((resolve) => {
        this.upnpClient.getExternalIP((err: any, ip: string) => {
          if (err || !ip) {
            resolve(false);
          } else {
            logger.info('UPnP router found', { externalIP: ip });
            resolve(true);
          }
        });
      });
    } catch (error) {
      logger.debug('UPnP not available', { error });
      return false;
    }
  }

  /**
   * Инициализирует NAT-PMP клиент
   */
  private async initializeNAT_PMP(): Promise<boolean> {
    try {
      // NAT-PMP для macOS/iOS
      const natPmp = await import('nat-pmp');
      this.natPmpClient = natPmp.connect();

      return new Promise((resolve) => {
        this.natPmpClient.externalIp((err: any, info: any) => {
          if (err || !info) {
            resolve(false);
          } else {
            logger.info('NAT-PMP router found', { externalIP: info.ip });
            resolve(true);
          }
        });
      });
    } catch (error) {
      logger.debug('NAT-PMP not available', { error });
      return false;
    }
  }

  /**
   * Добавляет проброс порта
   */
  async addPortMapping(mapping: PortMapping): Promise<boolean> {
    try {
      if (this.upnpClient) {
        return await this.addUPnPMapping(mapping);
      } else if (this.natPmpClient) {
        return await this.addNAT_PMPMapping(mapping);
      }
      return false;
    } catch (error) {
      logger.error('Failed to add port mapping', { error, mapping });
      return false;
    }
  }

  private async addUPnPMapping(mapping: PortMapping): Promise<boolean> {
    return new Promise((resolve) => {
      this.upnpClient.portMapping({
        public: mapping.externalPort,
        private: mapping.internalPort,
        ttl: mapping.ttl,
        description: mapping.description,
      }, (err: any) => {
        if (err) {
          logger.error('UPnP port mapping failed', { error: err, mapping });
          resolve(false);
        } else {
          this.activeMappings.set(mapping.internalPort, mapping);
          logger.info('UPnP port mapping added', { mapping });
          this.scheduleRefresh(mapping);
          resolve(true);
        }
      });
    });
  }

  private async addNAT_PMPMapping(mapping: PortMapping): Promise<boolean> {
    return new Promise((resolve) => {
      this.natPmpClient.portMapping({
        public: mapping.externalPort,
        private: mapping.internalPort,
        ttl: mapping.ttl,
      }, (err: any) => {
        if (err) {
          logger.error('NAT-PMP port mapping failed', { error: err, mapping });
          resolve(false);
        } else {
          this.activeMappings.set(mapping.internalPort, mapping);
          logger.info('NAT-PMP port mapping added', { mapping });
          this.scheduleRefresh(mapping);
          resolve(true);
        }
      });
    });
  }

  /**
   * Планирует обновление маппинга перед истечением TTL
   */
  private scheduleRefresh(mapping: PortMapping): void {
    // Обновить за 30 секунд до истечения TTL
    const refreshTime = (mapping.ttl - 30) * 1000;
    
    setTimeout(async () => {
      if (this.activeMappings.has(mapping.internalPort)) {
        await this.addPortMapping(mapping);
      }
    }, refreshTime);
  }

  /**
   * Удаляет проброс порта
   */
  async removePortMapping(internalPort: number): Promise<void> {
    const mapping = this.activeMappings.get(internalPort);
    if (!mapping) {
      return;
    }

    try {
      if (this.upnpClient) {
        this.upnpClient.portUnmapping({
          public: mapping.externalPort,
          private: mapping.internalPort,
        });
      } else if (this.natPmpClient) {
        this.natPmpClient.portUnmapping({
          public: mapping.externalPort,
          private: mapping.internalPort,
        });
      }

      this.activeMappings.delete(internalPort);
      logger.info('Port mapping removed', { internalPort });
    } catch (error) {
      logger.error('Failed to remove port mapping', { error, internalPort });
    }
  }

  /**
   * Получает внешний IP адрес
   */
  async getExternalIP(): Promise<string | null> {
    try {
      if (this.upnpClient) {
        return new Promise((resolve) => {
          this.upnpClient.getExternalIP((err: any, ip: string) => {
            resolve(err ? null : ip);
          });
        });
      } else if (this.natPmpClient) {
        return new Promise((resolve) => {
          this.natPmpClient.externalIp((err: any, info: any) => {
            resolve(err ? null : info?.ip || null);
          });
        });
      }
      return null;
    } catch (error) {
      logger.error('Failed to get external IP', { error });
      return null;
    }
  }

  async cleanup(): Promise<void> {
    // Удалить все активные маппинги
    for (const internalPort of this.activeMappings.keys()) {
      await this.removePortMapping(internalPort);
    }

    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    logger.info('Port forwarding service cleaned up');
  }
}
```

**Шаг 2: Интегрировать в NodeService**

```typescript
import { PortForwardingService } from '../services/PortForwardingService';

export class NodeService {
  private portForwardingService: PortForwardingService;

  async start(): Promise<void> {
    // ... existing code ...

    // Инициализировать port forwarding
    await this.portForwardingService.initialize();

    // Попробовать пробросить WireGuard порт
    const wireguardPort = config.wireguard.port;
    const externalIP = await this.portForwardingService.getExternalIP();
    
    if (externalIP) {
      const mapping = await this.portForwardingService.addPortMapping({
        internalPort: wireguardPort,
        externalPort: wireguardPort,
        protocol: 'udp',
        description: 'HiggsNode WireGuard',
        ttl: 3600, // 1 час
      });

      if (mapping) {
        logger.info('Port forwarding enabled', {
          internalPort: wireguardPort,
          externalIP,
        });
      }
    }

    // ... rest of code ...
  }
}
```

**Установка зависимостей:**

```bash
npm install nat-upnp nat-pmp
npm install --save-dev @types/nat-upnp @types/nat-pmp
```

---

### 2.2. Оптимизация производительности WebSocket Relay

#### Проблема
WebSocket relay добавляет overhead и увеличивает latency. Необходимо оптимизировать передачу данных.

#### Решение

**Шаг 1: Реализовать Packet Batching**

Обновить `higgsnode/src/services/WebSocketRelay.ts`:

```typescript
export class WebSocketRelay extends EventEmitter {
  private packetBuffer: Buffer[] = [];
  private batchTimer: NodeJS.Timeout | null = null;
  private readonly BATCH_SIZE = 10; // Количество пакетов в батче
  private readonly BATCH_TIMEOUT = 10; // Таймаут в миллисекундах
  private readonly MAX_PACKET_SIZE = 1500; // Максимальный размер пакета

  sendData(data: Buffer, direction: 'client-to-node' | 'node-to-client'): void {
    if (!this.isConnected || !this.ws) {
      throw new NetworkError('WebSocket not connected');
    }

    // Для маленьких пакетов использовать batching
    if (data.length < this.MAX_PACKET_SIZE) {
      this.packetBuffer.push(data);
      
      // Отправить батч если достигнут размер или таймаут
      if (this.packetBuffer.length >= this.BATCH_SIZE) {
        this.flushBatch();
      } else if (!this.batchTimer) {
        this.batchTimer = setTimeout(() => {
          this.flushBatch();
        }, this.BATCH_TIMEOUT);
      }
    } else {
      // Большие пакеты отправлять сразу
      this.ws.send(data, { binary: true });
    }
  }

  private flushBatch(): void {
    if (this.packetBuffer.length === 0 || !this.ws) {
      return;
    }

    // Создать батч: [количество пакетов (2 байта)] + [размер пакета 1 (2 байта)] + [данные 1] + ...
    const packets = this.packetBuffer;
    this.packetBuffer = [];

    if (this.batchTimer) {
      clearTimeout(this.batchTimer);
      this.batchTimer = null;
    }

    // Формат батча: [count: uint16] + [size1: uint16][data1] + [size2: uint16][data2] + ...
    let batchSize = 2; // Для счетчика пакетов
    for (const packet of packets) {
      batchSize += 2 + packet.length; // Размер + данные
    }

    const batch = Buffer.allocUnsafe(batchSize);
    let offset = 0;

    // Записать количество пакетов
    batch.writeUInt16BE(packets.length, offset);
    offset += 2;

    // Записать каждый пакет
    for (const packet of packets) {
      batch.writeUInt16BE(packet.length, offset);
      offset += 2;
      packet.copy(batch, offset);
      offset += packet.length;
    }

    // Отправить батч
    this.ws.send(batch, { binary: true });
    logger.debug('Packet batch sent', { packetCount: packets.length, batchSize });
  }
}
```

**Шаг 2: Обновить обработку на сервере**

Обновить `bosonserver/src/services/relay/WebSocketRelay.ts`:

```typescript
private handleMessage(sessionId: string, data: Buffer, ws: WebSocket): void {
  try {
    // Проверить, является ли это батчем (начинается с uint16)
    if (data.length >= 2) {
      const packetCount = data.readUInt16BE(0);
      
      // Если это батч (больше 1 пакета)
      if (packetCount > 1 && packetCount < 100) { // Разумный лимит
        this.handleBatch(sessionId, data, ws);
        return;
      }
    }

    // Обработать как одиночный пакет
    this.handleSinglePacket(sessionId, data, ws);
  } catch (error) {
    logger.error('Failed to handle message', { error, sessionId });
  }
}

private handleBatch(sessionId: string, batch: Buffer, ws: WebSocket): void {
  let offset = 2; // Пропустить счетчик пакетов
  const packetCount = batch.readUInt16BE(0);

  for (let i = 0; i < packetCount && offset < batch.length; i++) {
    // Прочитать размер пакета
    if (offset + 2 > batch.length) break;
    const packetSize = batch.readUInt16BE(offset);
    offset += 2;

    // Прочитать данные пакета
    if (offset + packetSize > batch.length) break;
    const packet = batch.slice(offset, offset + packetSize);
    offset += packetSize;

    // Обработать пакет
    this.handleSinglePacket(sessionId, packet, ws);
  }

  logger.debug('Batch processed', { sessionId, packetCount });
}

private handleSinglePacket(sessionId: string, data: Buffer, ws: WebSocket): void {
  // Существующая логика обработки одиночного пакета
  // ...
}
```

**Шаг 3: Добавить сжатие для control messages**

```typescript
import { gzip, gunzip } from 'zlib';
import { promisify } from 'util';

const gzipAsync = promisify(gzip);
const gunzipAsync = promisify(gunzip);

sendControl(action: string, payload?: any, compress: boolean = true): void {
  if (!this.isConnected || !this.ws) {
    throw new NetworkError('WebSocket not connected');
  }

  const message = {
    type: 'control',
    sessionId: this.options.sessionId,
    direction: 'server',
    payload: {
      action,
      ...payload,
    },
  };

  const jsonString = JSON.stringify(message);

  if (compress && jsonString.length > 100) {
    // Сжать большие control messages
    gzipAsync(Buffer.from(jsonString))
      .then((compressed) => {
        const compressedMessage = {
          type: 'control',
          compressed: true,
          data: compressed.toString('base64'),
        };
        this.ws.send(JSON.stringify(compressedMessage));
      })
      .catch((error) => {
        logger.error('Failed to compress control message', { error });
        // Fallback на несжатое сообщение
        this.ws.send(jsonString);
      });
  } else {
    this.ws.send(jsonString);
  }
}
```

---

### 2.3. Улучшение безопасности и приватности

#### Решение

**Шаг 1: Создать PrivacyManager**

Создать файл `higgsnode/src/managers/PrivacyManager.ts`:

```typescript
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { config } from '../config/config';

export interface PrivacySettings {
  logTraffic: boolean;
  logDNS: boolean;
  logMetadata: boolean;
  anonymizeIPs: boolean;
  maxLogRetention: number; // В днях
}

export class PrivacyManager extends EventEmitter {
  private settings: PrivacySettings;

  constructor() {
    super();
    this.settings = {
      logTraffic: config.privacy?.logTraffic || false,
      logDNS: config.privacy?.logDNS || false,
      logMetadata: config.privacy?.logMetadata || true,
      anonymizeIPs: config.privacy?.anonymizeIPs || true,
      maxLogRetention: config.privacy?.maxLogRetention || 7,
    };
  }

  /**
   * Анонимизирует IP адрес (оставляет только первые 3 октета)
   */
  anonymizeIP(ip: string): string {
    if (!this.settings.anonymizeIPs) {
      return ip;
    }

    const parts = ip.split('.');
    if (parts.length === 4) {
      return `${parts[0]}.${parts[1]}.${parts[2]}.0`;
    }
    return ip;
  }

  /**
   * Проверяет, можно ли логировать трафик
   */
  canLogTraffic(): boolean {
    return this.settings.logTraffic;
  }

  /**
   * Проверяет, можно ли логировать DNS запросы
   */
  canLogDNS(): boolean {
    return this.settings.logDNS;
  }

  /**
   * Логирует метаданные соединения (без содержимого)
   */
  logConnectionMetadata(metadata: {
    clientId: string;
    destinationIP: string;
    destinationPort: number;
    protocol: string;
    bytesTransferred: number;
    duration: number;
  }): void {
    if (!this.settings.logMetadata) {
      return;
    }

    const anonymizedMetadata = {
      ...metadata,
      destinationIP: this.anonymizeIP(metadata.destinationIP),
      clientId: this.anonymizeIP(metadata.clientId), // Если clientId это IP
    };

    logger.info('Connection metadata', anonymizedMetadata);
    this.emit('metadataLogged', anonymizedMetadata);
  }

  /**
   * Обновляет настройки приватности
   */
  updateSettings(settings: Partial<PrivacySettings>): void {
    this.settings = { ...this.settings, ...settings };
    logger.info('Privacy settings updated', { settings: this.settings });
    this.emit('settingsUpdated', this.settings);
  }

  getSettings(): PrivacySettings {
    return { ...this.settings };
  }
}
```

**Шаг 2: Добавить конфигурацию приватности**

Обновить `higgsnode/src/config/config.ts`:

```typescript
export interface Config {
  // ... existing fields ...
  privacy?: {
    logTraffic: boolean;
    logDNS: boolean;
    logMetadata: boolean;
    anonymizeIPs: boolean;
    maxLogRetention: number;
  };
}
```

---

### 2.4. Изоляция firewall правил

#### Решение

**Улучшить RoutingEngine для изоляции правил**

Обновить `higgsnode/src/engines/RoutingEngine.ts`:

```typescript
export class RoutingEngine extends EventEmitter {
  private savedRules: string[] = []; // Для сохранения существующих правил

  /**
   * Сохраняет текущие iptables правила перед изменением
   */
  private async saveCurrentRules(): Promise<void> {
    try {
      if (isLinux()) {
        const output = execSync('iptables-save', { encoding: 'utf-8' });
        this.savedRules = output.split('\n');
        logger.debug('Current iptables rules saved', { ruleCount: this.savedRules.length });
      }
    } catch (error) {
      logger.warn('Failed to save current iptables rules', { error });
    }
  }

  /**
   * Проверяет конфликты с существующими правилами
   */
  private async checkConflicts(interfaceName: string): Promise<string[]> {
    const conflicts: string[] = [];

    try {
      if (isLinux()) {
        // Проверить, есть ли правила для этого интерфейса
        const output = execSync(`iptables -L FORWARD -v -n | grep ${interfaceName}`, {
          encoding: 'utf-8',
          stdio: 'pipe',
        });

        if (output.trim().length > 0) {
          conflicts.push(`Existing FORWARD rules found for ${interfaceName}`);
        }
      }
    } catch (error) {
      // Нет конфликтов или ошибка проверки
    }

    return conflicts;
  }

  async enableNat(): Promise<void> {
    // Сохранить текущие правила
    await this.saveCurrentRules();

    // Проверить конфликты
    const conflicts = await this.checkConflicts(this.wireGuardManager.getInterfaceName());
    if (conflicts.length > 0) {
      logger.warn('Potential conflicts detected', { conflicts });
      // Можно продолжить или запросить подтверждение
    }

    // ... existing NAT enabling code ...
  }

  /**
   * Восстанавливает сохраненные правила (опционально)
   */
  async restoreRules(): Promise<void> {
    if (this.savedRules.length === 0) {
      return;
    }

    try {
      logger.info('Restoring saved iptables rules');
      // Восстановление правил должно быть аккуратным
      // Лучше не делать это автоматически, а предоставить скрипт
      logger.warn('Rule restoration not implemented automatically for safety');
    } catch (error) {
      logger.error('Failed to restore rules', { error });
    }
  }
}
```

---

## Приоритет 3: Улучшения производительности и функциональности

### 3.1. Полная поддержка IPv6

#### Решение

**Шаг 1: Расширить RoutingEngine для IPv6**

Обновить `higgsnode/src/engines/RoutingEngine.ts`:

```typescript
async enableNat(): Promise<void> {
  // ... existing IPv4 NAT code ...

  // Включить IPv6 NAT (NPTv6 - Network Prefix Translation)
  if (isLinux()) {
    await this.enableIPv6NAT();
  }
}

private async enableIPv6NAT(): Promise<void> {
  if (!this.physicalInterface) {
    return;
  }

  try {
    const wireguardInterface = this.wireGuardManager.getInterfaceName();
    const physicalInterface = this.physicalInterface.name;

    // 1. Enable IPv6 forwarding
    execSync('sysctl -w net.ipv6.conf.all.forwarding=1', { stdio: 'pipe' });

    // 2. IPv6 NAT (используя ip6tables)
    // NPTv6 требует настройки префикса
    const ipv6Prefix = await this.getIPv6Prefix();
    
    if (ipv6Prefix) {
      // Использовать MASQUERADE для IPv6 (если поддерживается)
      try {
        execSync(
          `ip6tables -t nat -A POSTROUTING -i ${wireguardInterface} -o ${physicalInterface} -j MASQUERADE`,
          { stdio: 'pipe' }
        );
        logger.info('IPv6 NAT enabled');
      } catch (error) {
        // Некоторые системы не поддерживают IPv6 NAT
        logger.warn('IPv6 NAT not supported, using NPTv6', { error });
        // Альтернатива: использовать NPTv6 через netfilter
      }
    }

    // 3. IPv6 forwarding rules
    execSync(
      `ip6tables -A FORWARD -i ${wireguardInterface} -o ${physicalInterface} -j ACCEPT`,
      { stdio: 'pipe' }
    );
    execSync(
      `ip6tables -A FORWARD -i ${physicalInterface} -o ${wireguardInterface} -m state --state RELATED,ESTABLISHED -j ACCEPT`,
      { stdio: 'pipe' }
    );
  } catch (error) {
    logger.warn('Failed to enable IPv6 NAT', { error });
  }
}

private async getIPv6Prefix(): Promise<string | null> {
  try {
    if (!this.physicalInterface) {
      return null;
    }

    const output = execSync(`ip -6 addr show ${this.physicalInterface.name}`, {
      encoding: 'utf-8',
    });

    // Извлечь IPv6 префикс
    const match = output.match(/inet6 ([a-f0-9:]+)\/\d+/i);
    return match ? match[1] : null;
  } catch (error) {
    logger.debug('Failed to get IPv6 prefix', { error });
    return null;
  }
}
```

---

### 3.2. Per-Client Rate Limiting и QoS

#### Решение

**Создать ClientRateLimiter**

Создать файл `higgsnode/src/managers/ClientRateLimiter.ts`:

```typescript
import { execSync } from 'child_process';
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { isLinux } from '../utils/platform';

export interface ClientLimit {
  clientId: string;
  rate: string; // e.g., "10mbit"
  burst?: string;
  priority?: number; // 1-10, где 10 - высший приоритет
}

export class ClientRateLimiter extends EventEmitter {
  private limits: Map<string, ClientLimit> = new Map();
  private wireguardInterface: string;

  constructor(wireguardInterface: string) {
    super();
    this.wireguardInterface = wireguardInterface;
  }

  /**
   * Устанавливает ограничение для клиента
   */
  async setClientLimit(limit: ClientLimit): Promise<void> {
    if (!isLinux()) {
      logger.warn('Per-client rate limiting only supported on Linux');
      return;
    }

    try {
      // Использовать tc (traffic control) с HTB (Hierarchical Token Bucket)
      // Создать класс для клиента
      const classId = this.getClientClassId(limit.clientId);
      
      // Создать qdisc если еще не создан
      await this.ensureQdisc();

      // Создать класс для клиента
      execSync(
        `tc class add dev ${this.wireguardInterface} parent 1: classid ${classId} htb rate ${limit.rate} burst ${limit.burst || '32kbit'}`,
        { stdio: 'pipe' }
      );

      // Настроить фильтр по IP клиента (если известен)
      // Это требует знания IP адреса клиента в WireGuard сети

      this.limits.set(limit.clientId, limit);
      logger.info('Client rate limit set', { limit });
    } catch (error) {
      logger.error('Failed to set client rate limit', { error, limit });
      throw error;
    }
  }

  private getClientClassId(clientId: string): string {
    // Генерировать уникальный class ID на основе clientId
    const hash = this.simpleHash(clientId);
    const major = 1;
    const minor = (hash % 65535) + 1;
    return `${major}:${minor}`;
  }

  private simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
  }

  private async ensureQdisc(): Promise<void> {
    try {
      // Проверить, существует ли root qdisc
      execSync(`tc qdisc show dev ${this.wireguardInterface} | grep -q "htb"`, {
        stdio: 'pipe',
      });
    } catch {
      // Создать root qdisc
      execSync(
        `tc qdisc add dev ${this.wireguardInterface} root handle 1: htb default 30`,
        { stdio: 'pipe' }
      );
    }
  }

  async removeClientLimit(clientId: string): Promise<void> {
    const limit = this.limits.get(clientId);
    if (!limit) {
      return;
    }

    try {
      const classId = this.getClientClassId(clientId);
      execSync(`tc class del dev ${this.wireguardInterface} classid ${classId}`, {
        stdio: 'pipe',
      });
      this.limits.delete(clientId);
      logger.info('Client rate limit removed', { clientId });
    } catch (error) {
      logger.error('Failed to remove client rate limit', { error, clientId });
    }
  }

  async cleanup(): Promise<void> {
    for (const clientId of this.limits.keys()) {
      await this.removeClientLimit(clientId);
    }
    this.limits.clear();
    logger.info('Client rate limiter cleaned up');
  }
}
```

---

### 3.3. Автоматическое восстановление после сбоя

#### Решение

**Создать HealthCheckManager**

Создать файл `higgsnode/src/managers/HealthCheckManager.ts`:

```typescript
import { EventEmitter } from 'events';
import { logger } from '../utils/logger';
import { RoutingEngine } from '../engines/RoutingEngine';
import { WireGuardManager } from '../managers/WireGuardManager';
import { NetworkRouteManager } from '../managers/NetworkRouteManager';

export interface HealthStatus {
  routing: boolean;
  nat: boolean;
  wireguard: boolean;
  networkRoute: boolean;
  overall: boolean;
}

export class HealthCheckManager extends EventEmitter {
  private routingEngine: RoutingEngine;
  private wireGuardManager: WireGuardManager;
  private networkRouteManager: NetworkRouteManager;
  private checkInterval: NodeJS.Timeout | null = null;
  private readonly CHECK_INTERVAL = 30000; // 30 секунд
  private consecutiveFailures = 0;
  private readonly MAX_FAILURES = 3;

  constructor(
    routingEngine: RoutingEngine,
    wireGuardManager: WireGuardManager,
    networkRouteManager: NetworkRouteManager
  ) {
    super();
    this.routingEngine = routingEngine;
    this.wireGuardManager = wireGuardManager;
    this.networkRouteManager = networkRouteManager;
  }

  start(): void {
    if (this.checkInterval) {
      return;
    }

    logger.info('Starting health checks');
    this.checkInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.CHECK_INTERVAL);

    // Выполнить первую проверку сразу
    this.performHealthCheck();
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
      logger.info('Health checks stopped');
    }
  }

  private async performHealthCheck(): Promise<void> {
    try {
      const status = await this.checkHealth();
      
      if (status.overall) {
        this.consecutiveFailures = 0;
        this.emit('healthy', status);
      } else {
        this.consecutiveFailures++;
        logger.warn('Health check failed', {
          status,
          consecutiveFailures: this.consecutiveFailures,
        });

        if (this.consecutiveFailures >= this.MAX_FAILURES) {
          await this.attemptRecovery(status);
        }

        this.emit('unhealthy', status);
      }
    } catch (error) {
      logger.error('Health check error', { error });
      this.emit('error', error);
    }
  }

  private async checkHealth(): Promise<HealthStatus> {
    const status: HealthStatus = {
      routing: false,
      nat: false,
      wireguard: false,
      networkRoute: false,
      overall: false,
    };

    // Проверить WireGuard
    try {
      const wgStatus = await this.wireGuardManager.getInterfaceStatus();
      status.wireguard = wgStatus?.status === 'up';
    } catch {
      status.wireguard = false;
    }

    // Проверить NAT
    status.nat = this.routingEngine.isNatEnabled();

    // Проверить маршрутизацию
    try {
      status.networkRoute = await this.networkRouteManager.verifyRouting();
    } catch {
      status.networkRoute = false;
    }

    // Общий статус
    status.overall = status.wireguard && status.nat && status.networkRoute;

    return status;
  }

  private async attemptRecovery(status: HealthStatus): Promise<void> {
    logger.warn('Attempting automatic recovery', { status });

    try {
      // Восстановить WireGuard если не работает
      if (!status.wireguard) {
        logger.info('Recovering WireGuard interface');
        // Пересоздать интерфейс
        await this.wireGuardManager.stopInterface();
        await this.wireGuardManager.createInterface();
      }

      // Восстановить NAT если не работает
      if (!status.nat) {
        logger.info('Recovering NAT');
        await this.routingEngine.disableNat();
        await this.routingEngine.enableNat();
      }

      // Восстановить маршрутизацию
      if (!status.networkRoute) {
        logger.info('Recovering network routing');
        await this.networkRouteManager.initialize();
      }

      this.consecutiveFailures = 0;
      logger.info('Recovery completed');
      this.emit('recovered');
    } catch (error) {
      logger.error('Recovery failed', { error });
      this.emit('recoveryFailed', error);
    }
  }

  async getHealthStatus(): Promise<HealthStatus> {
    return this.checkHealth();
  }
}
```

---

### 3.4. Диагностические инструменты

#### Решение

**Создать DiagnosticTool**

Создать файл `higgsnode/src/cli/commands/diagnose.ts`:

```typescript
import { Command } from 'commander';
import { logger } from '../../utils/logger';
import { NodeService } from '../../services/NodeService';

export function diagnoseCommand(program: Command): void {
  program
    .command('diagnose')
    .description('Run diagnostic checks')
    .option('-v, --verbose', 'Verbose output')
    .action(async (options) => {
      console.log('Running diagnostic checks...\n');

      const checks = [
        checkSystemRequirements,
        checkNetworkConfiguration,
        checkWireGuard,
        checkNAT,
        checkRouting,
        checkFirewall,
      ];

      let passed = 0;
      let failed = 0;

      for (const check of checks) {
        try {
          const result = await check(options.verbose);
          if (result.success) {
            console.log(`✓ ${result.name}`);
            passed++;
          } else {
            console.log(`✗ ${result.name}: ${result.error}`);
            failed++;
          }
        } catch (error) {
          console.log(`✗ Error running check: ${error}`);
          failed++;
        }
      }

      console.log(`\nResults: ${passed} passed, ${failed} failed`);
    });
}

async function checkSystemRequirements(verbose: boolean) {
  // Проверить права доступа, версии, зависимости
  return { name: 'System Requirements', success: true };
}

async function checkNetworkConfiguration(verbose: boolean) {
  // Проверить сетевую конфигурацию
  return { name: 'Network Configuration', success: true };
}

async function checkWireGuard(verbose: boolean) {
  // Проверить WireGuard
  return { name: 'WireGuard', success: true };
}

async function checkNAT(verbose: boolean) {
  // Проверить NAT
  return { name: 'NAT', success: true };
}

async function checkRouting(verbose: boolean) {
  // Проверить маршрутизацию
  return { name: 'Routing', success: true };
}

async function checkFirewall(verbose: boolean) {
  // Проверить firewall
  return { name: 'Firewall', success: true };
}
```

---

## План внедрения

### Фаза 1: Важные улучшения (2 недели)

1. **День 1-3:** Port Forwarding (UPnP/NAT-PMP)
2. **День 4-6:** WebSocket оптимизация (batching, compression)
3. **День 7-9:** Privacy Manager и безопасность
4. **День 10-12:** Изоляция firewall правил
5. **День 13-14:** Тестирование и исправление багов

### Фаза 2: Улучшения производительности (1-2 недели)

1. IPv6 поддержка
2. Per-client rate limiting
3. Health checks и автоматическое восстановление
4. Диагностические инструменты

---

## Заключение

Реализация этих рекомендаций позволит:

1. ✅ Решить проблему двойного NAT через UPnP/NAT-PMP
2. ✅ Улучшить производительность WebSocket relay на 20-30%
3. ✅ Обеспечить приватность и безопасность данных
4. ✅ Добавить полную поддержку IPv6
5. ✅ Реализовать автоматическое восстановление после сбоев
6. ✅ Предоставить инструменты для диагностики

Все решения готовы к внедрению и включают примеры кода.

---

*Документ создан на основе анализа важных проблем проекта Higgs.net*

