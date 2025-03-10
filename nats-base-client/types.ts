/*
 * Copyright 2020-2022 The NATS Authors
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
import { NatsError } from "./error.ts";
import type { MsgHdrs } from "./headers.ts";
import type { Authenticator } from "./authenticator.ts";
import { TypedSubscriptionOptions } from "./typedsub.ts";
import { QueuedIterator } from "./queued_iterator.ts";

export const Empty = new Uint8Array(0);

export enum Events {
  Disconnect = "disconnect",
  Reconnect = "reconnect",
  Update = "update",
  LDM = "ldm",
  Error = "error",
}

export interface Status {
  type: Events | DebugEvents;
  data: string | ServersChanged | number;
}

export enum DebugEvents {
  Reconnecting = "reconnecting",
  PingTimer = "pingTimer",
  StaleConnection = "staleConnection",
}

export const DEFAULT_PORT = 4222;
export const DEFAULT_HOST = "127.0.0.1";

// DISCONNECT Parameters, 2 sec wait, 10 tries
export const DEFAULT_RECONNECT_TIME_WAIT = 2 * 1000;
export const DEFAULT_MAX_RECONNECT_ATTEMPTS = 10;
export const DEFAULT_JITTER = 100;
export const DEFAULT_JITTER_TLS = 1000;

// Ping interval
export const DEFAULT_PING_INTERVAL = 2 * 60 * 1000; // 2 minutes
export const DEFAULT_MAX_PING_OUT = 2;

export interface ConnectFn {
  (opts: ConnectionOptions): Promise<NatsConnection>;
}

export interface NatsConnection {
  info?: ServerInfo;
  closed(): Promise<void | Error>;
  close(): Promise<void>;
  publish(subject: string, data?: Uint8Array, options?: PublishOptions): void;
  subscribe(subject: string, opts?: SubscriptionOptions): Subscription;
  request(
    subject: string,
    data?: Uint8Array,
    opts?: RequestOptions,
  ): Promise<Msg>;
  flush(): Promise<void>;
  drain(): Promise<void>;
  isClosed(): boolean;
  isDraining(): boolean;
  getServer(): string;
  status(): AsyncIterable<Status>;
  stats(): Stats;

  jetstreamManager(opts?: JetStreamOptions): Promise<JetStreamManager>;
  jetstream(opts?: JetStreamOptions): JetStreamClient;
}

export interface ConnectionOptions {
  authenticator?: Authenticator;
  debug?: boolean;
  maxPingOut?: number;
  maxReconnectAttempts?: number;
  name?: string;
  noEcho?: boolean;
  noRandomize?: boolean;
  pass?: string;
  pedantic?: boolean;
  pingInterval?: number;
  port?: number;
  reconnect?: boolean;
  reconnectDelayHandler?: () => number;
  reconnectJitter?: number;
  reconnectJitterTLS?: number;
  reconnectTimeWait?: number;
  servers?: Array<string> | string;
  timeout?: number;
  tls?: TlsOptions;
  token?: string;
  user?: string;
  verbose?: boolean;
  waitOnFirstConnect?: boolean;
  ignoreClusterUpdates?: boolean;
  inboxPrefix?: string;
}

// these may not be supported on all environments
export interface TlsOptions {
  certFile?: string;
  cert?: string;
  caFile?: string;
  ca?: string;
  keyFile?: string;
  key?: string;
}

export interface Msg {
  subject: string;
  sid: number;
  reply?: string;
  data: Uint8Array;
  headers?: MsgHdrs;

  respond(data?: Uint8Array, opts?: PublishOptions): boolean;
}

export interface SubOpts<T> {
  queue?: string;
  max?: number;
  timeout?: number;
  callback?: (err: NatsError | null, msg: T) => void;
}

export type SubscriptionOptions = SubOpts<Msg>;

export interface Base {
  subject: string;
  callback: (error: NatsError | null, msg: Msg) => void;
  received: number;
  timeout?: number | null;
  max?: number | undefined;
  draining: boolean;
}

export interface ServerInfo {
  "auth_required"?: boolean;
  "client_id": number;
  "client_ip"?: string;
  cluster?: string;
  "connect_urls"?: string[];
  "git_commit"?: string;
  go: string;
  headers?: boolean;
  host: string;
  jetstream?: boolean;
  ldm?: boolean;
  "max_payload": number;
  nonce?: string;
  port: number;
  proto: number;
  "server_id": string;
  "server_name": string;
  "tls_available"?: boolean;
  "tls_required"?: boolean;
  "tls_verify"?: boolean;
  version: string;
}

export interface Server {
  hostname: string;
  port: number;
  listen: string;
  src: string;
  tlsName: string;

  resolve(
    opts: Partial<{ fn: DnsResolveFn; randomize: boolean }>,
  ): Promise<Server[]>;
}

export interface ServersChanged {
  readonly added: string[];
  readonly deleted: string[];
}

export interface Sub<T> extends AsyncIterable<T> {
  closed: Promise<void>;
  unsubscribe(max?: number): void;
  drain(): Promise<void>;
  isDraining(): boolean;
  isClosed(): boolean;
  callback(err: NatsError | null, msg: Msg): void;
  getSubject(): string;
  getReceived(): number;
  getProcessed(): number;
  getPending(): number;
  getID(): number;
  getMax(): number | undefined;
}

export type Subscription = Sub<Msg>;

export interface RequestOptions {
  timeout: number;
  headers?: MsgHdrs;
  noMux?: boolean;
  reply?: string;
}

export interface PublishOptions {
  reply?: string;
  headers?: MsgHdrs;
}

export interface Stats {
  inBytes: number;
  outBytes: number;
  inMsgs: number;
  outMsgs: number;
}

export interface URLParseFn {
  (u: string): string;
}

export interface DnsResolveFn {
  (h: string): Promise<string[]>;
}

// JetStream
export interface JetStreamOptions {
  apiPrefix?: string;
  timeout?: number;
  domain?: string;
}

export interface JetStreamManager {
  consumers: ConsumerAPI;
  streams: StreamAPI;
  getAccountInfo(): Promise<JetStreamAccountStats>;
  advisories(): AsyncIterable<Advisory>;
}

export interface PullOptions {
  batch: number;
  "no_wait": boolean;
  expires: number;
}

export interface PubAck {
  stream: string;
  domain?: string;
  seq: number;
  duplicate: boolean;

  ack(): void;
}

export interface JetStreamPublishOptions {
  msgID: string;
  timeout: number;
  ackWait: Nanos;
  headers: MsgHdrs;
  expect: Partial<{
    lastMsgID: string;
    streamName: string;
    lastSequence: number;
    lastSubjectSequence: number;
  }>;
}

export interface ConsumerInfoable {
  consumerInfo(): Promise<ConsumerInfo>;
}

export interface Closed {
  closed: Promise<void>;
}

export type JetStreamSubscription =
  & Sub<JsMsg>
  & Destroyable
  & Closed
  & ConsumerInfoable;

export type JetStreamSubscriptionOptions = TypedSubscriptionOptions<JsMsg>;

export interface Pullable {
  pull(opts?: Partial<PullOptions>): void;
}

export interface Destroyable {
  destroy(): Promise<void>;
}

export type JetStreamPullSubscription = JetStreamSubscription & Pullable;

export type JsMsgCallback = (err: NatsError | null, msg: JsMsg | null) => void;

export interface Views {
  kv: (name: string, opts?: Partial<KvOptions>) => Promise<KV>;
}

// FIXME: pulls must limit to maxAcksInFlight
export interface JetStreamClient {
  publish(
    subj: string,
    data?: Uint8Array,
    options?: Partial<JetStreamPublishOptions>,
  ): Promise<PubAck>;
  pull(stream: string, durable: string): Promise<JsMsg>;
  fetch(
    stream: string,
    durable: string,
    opts?: Partial<PullOptions>,
  ): QueuedIterator<JsMsg>;
  pullSubscribe(
    subject: string,
    opts: ConsumerOptsBuilder | Partial<ConsumerOpts>,
  ): Promise<JetStreamPullSubscription>;
  subscribe(
    subject: string,
    opts: ConsumerOptsBuilder | Partial<ConsumerOpts>,
  ): Promise<JetStreamSubscription>;
  views: Views;
}

export interface ConsumerOpts {
  config: Partial<ConsumerConfig>;
  mack: boolean;
  stream: string;
  callbackFn?: JsMsgCallback;
  name?: string;
  ordered: boolean;

  // standard
  max?: number;
  queue?: string;
  debug?: boolean;
  isBind?: boolean;
}

export interface ConsumerOptsBuilder {
  // user description of this consumer
  description(description: string): void;
  // deliverTo sets the subject a push consumer receives messages on
  deliverTo(subject: string): void;
  // sets the durable name, when not set an ephemeral consumer is created
  durable(name: string): void;
  // consumer will start at the message with the specified sequence
  startSequence(seq: number): void;
  // consumer will start with messages received on the specified time/date
  startTime(time: Date): void;
  // consumer will start at first available message on the stream
  deliverAll(): void;
  // consumer will deliver all the last per messages per subject
  deliverLastPerSubject(): void;
  // consumer will start at the last message
  deliverLast(): void;
  // consumer will start with new messages (not yet in the stream)
  deliverNew(): void;
  // start delivering at the at a past point in time
  startAtTimeDelta(millis: number): void;
  // deliver headers and `Nats-Msg-Size` header, no payloads
  headersOnly(): void;
  // disables message acknowledgement
  ackNone(): void;
  // ack'ing a message implicitly acks all messages with a lower sequence
  ackAll(): void;
  // consumer will ack all messages
  ackExplicit(): void;
  // sets teh time a delivered message might remain unacknowledged before redelivery is attempted
  ackWait(millis: number): void;
  // max number of re-delivery attempts for a particular message
  maxDeliver(max: number): void;
  // filters the messages in a wildcard stream to those matching a specific subject
  filterSubject(s: string): void;
  // replay messages as fast as possible
  replayInstantly(): void;
  // replay at the rate received
  replayOriginal(): void;
  // sample a subset of messages expressed as a percentage(0-100)
  sample(n: number): void;
  // limit message delivery to rate in bits per second
  limit(bps: number): void;
  // max count of outstanding messages scheduled via batch pulls (pulls are additive)
  maxWaiting(max: number): void;
  // max number of outstanding acks before the server stops sending new messages
  maxAckPending(max: number): void;
  // sets the time before an idle consumer sends an empty message with status 100 indicating consumer is alive
  idleHeartbeat(millis: number): void;
  // push consumer flow control - server sends a status code 100 and uses the delay on the response to throttle inbound messages for a client and prevent slow consumer.
  flowControl(): void;
  // sets the name of the queue group - same as queue
  deliverGroup(name: string): void;
  // prevents the consumer implementation from auto-acking messages
  manualAck(): void;
  // standard nats subscribe option for the maximum number of messages to receive on the subscription
  maxMessages(max: number): void;
  // standard nats queue group option
  queue(n: string): void;
  // callback to process messages (or iterator is returned)
  callback(fn: JsMsgCallback): void;
  // creates an ordered consumer - ordered consumers cannot be a pull consumer nor specify durable, deliverTo, specify an ack policy, maxDeliver, or flow control.
  orderedConsumer(): void;
  // binds to a consumer
  bind(stream: string, durable: string): void;
  // max number of messages to be delivered to a pull consumer (pull consumer only)
  maxPullBatch(n: number): void;
  // max amount of time before a pull request expires
  maxPullRequestExpires(millis: number): void;
  // max amount of time before an inactive ephemeral consumer is discarded
  inactiveEphemeralThreshold(millis: number): void;
}

export interface Lister<T> {
  next(): Promise<T[]>;
}

export interface ConsumerAPI {
  info(stream: string, consumer: string): Promise<ConsumerInfo>;
  add(stream: string, cfg: Partial<ConsumerConfig>): Promise<ConsumerInfo>;
  update(
    stream: string,
    durable: string,
    cfg: ConsumerUpdateConfig,
  ): Promise<ConsumerInfo>;
  delete(stream: string, consumer: string): Promise<boolean>;
  list(stream: string): Lister<ConsumerInfo>;
}

export type StreamInfoRequestOptions = {
  "deleted_details": boolean;
};

export interface StreamAPI {
  info(
    stream: string,
    opts?: Partial<StreamInfoRequestOptions>,
  ): Promise<StreamInfo>;
  add(cfg: Partial<StreamConfig>): Promise<StreamInfo>;
  update(name: string, cfg: Partial<StreamUpdateConfig>): Promise<StreamInfo>;
  purge(stream: string, opts?: PurgeOpts): Promise<PurgeResponse>;
  delete(stream: string): Promise<boolean>;
  list(): Lister<StreamInfo>;
  deleteMessage(stream: string, seq: number, erase?: boolean): Promise<boolean>;
  getMessage(stream: string, query: MsgRequest): Promise<StoredMsg>;
  find(subject: string): Promise<string>;
}

export interface JsMsg {
  redelivered: boolean;
  info: DeliveryInfo;
  seq: number;
  headers: MsgHdrs | undefined;
  data: Uint8Array;
  subject: string;
  sid: number;

  ack(): void;
  nak(millis?: number): void;
  working(): void;
  // next(subj?: string): void;
  term(): void;
  ackAck(): Promise<boolean>;
}

export interface DeliveryInfo {
  domain: string;
  "account_hash"?: string;
  stream: string;
  consumer: string;
  redeliveryCount: number;
  streamSequence: number;
  deliverySequence: number;
  timestampNanos: number;
  pending: number;
  redelivered: boolean;
}

export interface StoredMsg {
  subject: string;
  seq: number;
  header: MsgHdrs;
  data: Uint8Array;
  time: Date;
}

export interface Advisory {
  kind: AdvisoryKind;
  data: unknown;
}

export enum AdvisoryKind {
  API = "api_audit",
  StreamAction = "stream_action",
  ConsumerAction = "consumer_action",
  SnapshotCreate = "snapshot_create",
  SnapshotComplete = "snapshot_complete",
  RestoreCreate = "restore_create",
  RestoreComplete = "restore_complete",
  MaxDeliver = "max_deliver",
  Terminated = "terminated",
  Ack = "consumer_ack",
  StreamLeaderElected = "stream_leader_elected",
  StreamQuorumLost = "stream_quorum_lost",
  ConsumerLeaderElected = "consumer_leader_elected",
  ConsumerQuorumLost = "consumer_quorum_lost",
}

// JetStream Server Types

export type Nanos = number;

export interface ApiError {
  code: number;
  description: string;
  err_code?: number;
}

export interface ApiResponse {
  type: string;
  error?: ApiError;
}

export interface ApiPaged {
  total: number;
  offset: number;
  limit: number;
}

export interface ApiPagedRequest {
  offset: number;
}

export interface StreamInfo {
  config: StreamConfig;
  created: number; // in ns
  state: StreamState;
  cluster?: ClusterInfo;
  mirror?: StreamSourceInfo;
  sources?: StreamSourceInfo[];
}

export interface StreamConfig extends StreamUpdateConfig {
  name: string;
  retention: RetentionPolicy;
  storage: StorageType;
  "num_replicas": number;
  "template_owner"?: string;
  "max_consumers": number;
  placement?: Placement;
  mirror?: StreamSource; // same as a source
  sealed: boolean;
  "deny_delete": boolean;
  "deny_purge": boolean;
}

export interface StreamUpdateConfig {
  subjects: string[];
  description?: string;
  "max_msgs_per_subject": number;
  "max_msgs": number;
  "max_age": Nanos;
  "max_bytes": number;
  "max_msg_size": number;
  discard: DiscardPolicy;
  "no_ack"?: boolean;
  "duplicate_window": Nanos;
  sources?: StreamSource[];
  "allow_rollup_hdrs": boolean;
}

export interface StreamSource {
  name: string;
  "opt_start_seq"?: number;
  "opt_start_time"?: string;
  "filter_subject"?: string;
}

export interface Placement {
  cluster: string;
  tags: string[];
}

export enum RetentionPolicy {
  Limits = "limits",
  Interest = "interest",
  Workqueue = "workqueue",
}

export enum DiscardPolicy {
  Old = "old",
  New = "new",
}

export enum StorageType {
  File = "file",
  Memory = "memory",
}

export enum DeliverPolicy {
  All = "all",
  Last = "last",
  New = "new",
  StartSequence = "by_start_sequence",
  StartTime = "by_start_time",
  LastPerSubject = "last_per_subject",
}

export enum AckPolicy {
  None = "none",
  All = "all",
  Explicit = "explicit",
  NotSet = "",
}

export enum ReplayPolicy {
  Instant = "instant",
  Original = "original",
}

export interface StreamState {
  messages: number;
  bytes: number;
  "first_seq": number;
  "first_ts": number;
  "last_seq": number;
  "last_ts": string;
  "num_deleted": number;
  deleted: number[];
  lost: LostStreamData;
  "consumer_count": number;
}

export interface LostStreamData {
  msgs: number;
  bytes: number;
}

export interface ClusterInfo {
  name?: string;
  leader?: string;
  replicas?: PeerInfo[];
}

export interface PeerInfo {
  name: string;
  current: boolean;
  offline: boolean;
  active: Nanos;
  lag: number;
}

export interface StreamSourceInfo {
  name: string;
  lag: number;
  active: Nanos;
  error?: ApiError;
}

export type PurgeOpts = PurgeBySeq | PurgeTrimOpts | PurgeBySubject;

export type PurgeBySeq = {
  // a subject to filter on (can include wildcards)
  filter?: string;
  // not inclusive
  seq: number;
};

export type PurgeTrimOpts = {
  // a subject to filter on (can include wildcards)
  filter?: string;
  keep: number;
};

export type PurgeBySubject = {
  filter: string;
};

export interface PurgeResponse extends Success {
  purged: number;
}

export interface CreateConsumerRequest {
  "stream_name": string;
  config: Partial<ConsumerConfig>;
}

export interface StreamMsgResponse extends ApiResponse {
  message: {
    subject: string;
    seq: number;
    data: string;
    hdrs: string;
    time: string;
  };
}

export interface SequenceInfo {
  "consumer_seq": number;
  "stream_seq": number;
  "last_active": Nanos;
}

export interface ConsumerInfo {
  "stream_name": string;
  name: string;
  created: number;
  config: ConsumerConfig;
  delivered: SequenceInfo;
  "ack_floor": SequenceInfo;
  "num_ack_pending": number;
  "num_redelivered": number;
  "num_waiting": number;
  "num_pending": number;
  cluster?: ClusterInfo;
}

export interface ConsumerListResponse extends ApiResponse, ApiPaged {
  consumers: ConsumerInfo[];
}

export interface StreamListResponse extends ApiResponse, ApiPaged {
  streams: StreamInfo[];
}

export interface Success {
  success: boolean;
}

export type SuccessResponse = ApiResponse & Success;

export interface LastForMsgRequest {
  "last_by_subj": string;
}

export interface SeqMsgRequest {
  seq: number;
}

// FIXME: remove number as it is deprecated
export type MsgRequest = SeqMsgRequest | LastForMsgRequest | number;

export interface MsgDeleteRequest extends SeqMsgRequest {
  "no_erase"?: boolean;
}

export interface JetStreamAccountStats {
  memory: number;
  storage: number;
  streams: number;
  consumers: number;
  api: JetStreamApiStats;
  limits: AccountLimits;
  domain?: string;
}

export interface JetStreamApiStats {
  total: number;
  errors: number;
}

export interface AccountInfoResponse
  extends ApiResponse, JetStreamAccountStats {}

export interface AccountLimits {
  "max_memory": number;
  "max_storage": number;
  "max_streams": number;
  "max_consumers": number;
}

export interface ConsumerConfig extends ConsumerUpdateConfig {
  "ack_policy": AckPolicy;
  "deliver_policy": DeliverPolicy;
  "deliver_group"?: string;
  "durable_name"?: string;
  "filter_subject"?: string;
  "flow_control"?: boolean; // send message with status of 100 and reply subject
  "idle_heartbeat"?: Nanos; // send empty message when idle longer than this
  "opt_start_seq"?: number;
  "opt_start_time"?: string;
  "rate_limit_bps"?: number;
  "replay_policy": ReplayPolicy;
}

export interface ConsumerUpdateConfig {
  description?: string;
  "ack_wait"?: Nanos;
  "max_deliver"?: number;
  "sample_freq"?: string;
  "max_ack_pending"?: number;
  "max_waiting"?: number;
  "headers_only"?: boolean;
  "deliver_subject"?: string;
  "max_batch"?: number;
  "max_expires"?: Nanos;
  "inactive_threshold"?: Nanos;
}

export interface Consumer {
  "stream_name": string;
  config: ConsumerConfig;
}

export interface StreamNames {
  streams: string[];
}

export interface StreamNameBySubject {
  subject: string;
}

export interface NextRequest {
  expires: number;
  batch: number;
  "no_wait": boolean;
}

export enum JsHeaders {
  // set if message coming from a stream source format is `stream seq`
  StreamSourceHdr = "Nats-Stream-Source",
  // set for heartbeat messages
  LastConsumerSeqHdr = "Nats-Last-Consumer",
  // set for heartbeat messages
  LastStreamSeqHdr = "Nats-Last-Stream",
  // set for heartbeat messages if stalled
  ConsumerStalledHdr = "Nats-Consumer-Stalled",
  // set for headers_only consumers indicates number
  MessageSizeHdr = "Nats-Msg-Size",
  // rollup header
  RollupHdr = "Nats-Rollup",
  // value for rollup header when rolling up a subject
  RollupValueSubject = "sub",
  // value for rollup header when rolling up all subjects
  RollupValueAll = "all",
}

export interface KvEntry {
  bucket: string;
  key: string;
  value: Uint8Array;
  created: Date;
  revision: number;
  delta?: number;
  operation: "PUT" | "DEL" | "PURGE";
  length: number;
}

export interface KvCodec<T> {
  encode(k: T): T;
  decode(k: T): T;
}

export interface KvCodecs {
  key: KvCodec<string>;
  value: KvCodec<Uint8Array>;
}

export interface KvStatus {
  bucket: string;
  values: number;
  history: number;
  ttl: Nanos;
  backingStore: StorageType;
}

export interface KvOptions {
  replicas: number;
  history: number;
  timeout: number;
  maxBucketSize: number;
  maxValueSize: number;
  placementCluster: string;
  mirrorBucket: string;
  ttl: number; // millis
  streamName: string;
  codec: KvCodecs;
  storage: StorageType;
  bindOnly: boolean;
}

/**
 * @deprecated use purge(k)
 */
export interface KvRemove {
  remove(k: string): Promise<void>;
}

export interface RoKV {
  get(k: string): Promise<KvEntry | null>;
  history(opts?: { key?: string }): Promise<QueuedIterator<KvEntry>>;
  watch(
    opts?: { key?: string; headers_only?: boolean; initializedFn?: callbackFn },
  ): Promise<QueuedIterator<KvEntry>>;
  close(): Promise<void>;
  status(): Promise<KvStatus>;
  keys(k?: string): Promise<QueuedIterator<string>>;
}

export interface KV extends RoKV {
  create(k: string, data: Uint8Array): Promise<number>;
  update(k: string, data: Uint8Array, version: number): Promise<number>;
  put(
    k: string,
    data: Uint8Array,
    opts?: Partial<KvPutOptions>,
  ): Promise<number>;
  delete(k: string): Promise<void>;
  purge(k: string): Promise<void>;
  destroy(): Promise<boolean>;
}

export interface KvPutOptions {
  previousSeq: number;
}

export type callbackFn = () => void;
