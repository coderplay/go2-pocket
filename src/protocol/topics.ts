export const RTC_TOPIC = {
  // Publishers (send to robot)
  SPORT_MOD: 'rt/api/sport/request',
  OBSTACLES_AVOID: 'rt/api/obstacles_avoid/request',
  VUI: 'rt/api/vui/request',
  // G1 voice service. The G1's speaker volume lives here (GET 1005 / SET 1006,
  // scale 0-100), not on vui — vui 1004 never answers on G1.
  VOICE: 'rt/api/voice/request',
  BASHRUNNER: 'rt/api/bashrunner/request',
  MOTION_SWITCHER: 'rt/api/motion_switcher/request',
  ROBOT_STATE: 'rt/api/robot_state/request',
  GAS_SENSOR: 'rt/api/gas_sensor/request',
  PET: 'rt/api/pet/request',
  CONFIG: 'rt/api/config/request',
  VIDEOHUB: 'rt/api/videohub/request',
  AUDIOHUB: 'rt/api/audiohub/request',
  // Audiohub playback-state push (Go2). Subscribe to receive JSON
  // { is_playing, current_audio_unique_id, current_audio_custom_name }
  // whenever a track starts/stops/advances (incl. loop-mode transitions).
  AUDIOHUB_PLAY_STATE: 'rt/audiohub/player/state',
  // G1 playback signal. The G1 audio_hub never publishes the player/state
  // topic above; instead the lower-level voice player emits rt/audio_msg,
  // filtered here. Payload is a JSON String with a `play_state` field —
  // play_state === 0 means playback stopped/ended.
  AUDIO_MSG_FILTER: 'rt/audio_msg/filter',
  FOURG_AGENT: 'rt/api/fourg_agent/request',
  // Internet remote-connection permission. Get: api_id=1001, no params.
  // Set: api_id=1002, params { enable_status: 2 (enabled) | 1 (disabled) }.
  // Source: NetPermissionModel.kt / DogApiId.PERMISSION_NET_{GET,SET}.
  PERMISSION_NET: 'rt/api/rm_con/request',
  WIRELESS_CONTROLLER: 'rt/wirelesscontroller',
  LIDAR_SWITCH: 'rt/utlidar/switch',
  LOW_CMD: 'rt/lowcmd',

  // Subscribers (receive from robot)
  LOW_STATE: 'rt/lf/lowstate',
  LF_SPORT_MOD_STATE: 'rt/lf/sportmodestate',
  LIDAR_ARRAY: 'rt/utlidar/voxel_map_compressed',
  LIDAR_STATE: 'rt/utlidar/lidar_state',
  ROBOT_ODOM: 'rt/utlidar/robot_pose',
  MULTIPLE_STATE: 'rt/multiplestate',
  SELFTEST: 'rt/selftest',
  SERVICE_STATE: 'rt/servicestate',
  BATTERY_ALARM: 'rt/lf/battery_alarm',
  UWB_STATE: 'rt/uwbstate',
  PUBLIC_NETWORK_STATUS: 'rt/public_network_status',

  // G1-specific (firmware 1.5.1+) — humanoid topics.
  // Request routing on G1:
  //   - Full-body modes (ZeroTorque, Preparation, Walk, ...) → SPORT_MOD,
  //     api_id=7101 (G1State), param={"data":<mode_index>}.
  //   - Upper-limb gestures (Handshake, Hug, ...)            → G1_ARM_REQUEST,
  //     api_id=7106 (G1UpperLimbs), param={"data":<gesture_index>}.
  // BMS_STATE carries battery (G1 doesn't ship the bms struct inside
  // rt/lf/lowstate the way Go2 does). DOUBLE_IMU carries both
  // imu_in_torso ("Body IMU") and imu_in_pelvis ("Crotch IMU") in one
  // frame.
  G1_ARM_REQUEST: 'rt/api/arm/request',
  // G1 machine/robot-type query. Request api_id 1001 with {"version":""};
  // response JSON carries { robot_type: "<number>" }. G1-only service.
  ROBOT_TYPE: 'rt/api/robot_type_service/request',
  G1_ARM_ACTION_STATE: 'rt/arm/action/state',
  G1_DEX3_LEFT_STATE: 'rt/lf/dex3/left/state',
  G1_DEX3_RIGHT_STATE: 'rt/lf/dex3/right/state',
  BMS_STATE: 'rt/lf/bmsstate',
  // G1/R1/H1 mainboard state. Carries the chassis ("Body") temperature the
  // official webview status bar shows — temperature[0], signed-byte. Go2 has
  // no mainboard topic; its body temp rides in lowstate as temperature_ntc1.
  // Verified against index-CtgArt9k.js (MAIN_BOARD_STATE = rt/lf/mainboardstate).
  MAIN_BOARD_STATE: 'rt/lf/mainboardstate',
  // The second (pelvis / "Crotch") IMU. The body IMU rides inside the
  // regular lowstate envelope's imu_state field on G1, while the
  // pelvis IMU is published as its own G1ImuState payload on this
  // topic. Verified against DogCmdConstant.DOUBLE_IMU and
  // BaseInfoViewModel.kt:195 in the decompiled apk.
  SECONDARY_IMU: 'rt/lf/secondary_imu',

  // USLAM (3D LiDAR Mapping / Navigation / Patrol)
  USLAM_CMD: 'rt/uslam/client_command',
  USLAM_SERVER_LOG: 'rt/uslam/server_log',
  USLAM_CLOUD_WORLD: 'rt/uslam/frontend/cloud_world_ds',
  USLAM_ODOM: 'rt/uslam/frontend/odom',
  USLAM_CLOUD_MAP: 'rt/uslam/cloud_map',
  USLAM_LOC_ODOM: 'rt/uslam/localization/odom',
  USLAM_LOC_CLOUD: 'rt/uslam/localization/cloud_world',
  USLAM_NAV_PATH: 'rt/uslam/navigation/global_path',
  USLAM_GRID_MAP: 'rt/mapping/grid_map',
} as const;

// G1 Demo Teaching (api_ids on the `arm` service → RTC_TOPIC.G1_ARM_REQUEST).
// Recording/playback state is pushed on RTC_TOPIC.G1_ARM_ACTION_STATE
// (rt/arm/action/state) as { id }. Verified against the decompiled APK
// (com.unitree.g1_d.ui.teaching.*, DogApiId 7106-7113).
//   state id — record ctx: -1 active, 0 saved | play ctx: 0 idle, 99 prep, 100 running
export const G1_TEACH_API = {
  UNITREE_ACTION: 7106, // built-in Unitree actions (unused here)
  LIST: 7107,           // list recorded actions (no param) → [[presets],[recorded]]
  PLAY: 7108,           // { action_name }
  RENAME: 7109,         // { pre_name, new_name }
  START: 7110,          // start { action_name } · heartbeat { action_name:"" } · stop (no param)
  PAUSE: 7111,          // { pause: boolean }
  DELETE: 7112,         // { action_name }
  ARM_TEACH: 7113,      // stop playback / exit teach mode (no param)
} as const;

// Sport-service damp (emergency relax) used by the teaching player.
// Topic RTC_TOPIC.SPORT_MOD, param { data: 1 }.
export const G1_SPORT_DAMP = 7101;

export const SPORT_CMD = {
  // Shared across Normal/AI/MCF (1xxx)
  Damp: 1001,
  BalanceStand: 1002,
  StopMove: 1003,
  StandUp: 1004,
  StandDown: 1005,
  RecoveryStand: 1006,
  Euler: 1007,
  Move: 1008,
  Sit: 1009,
  RiseSit: 1010,
  SwitchGait: 1011,
  Trigger: 1012,
  BodyHeight: 1013,
  FootRaiseHeight: 1014,
  SpeedLevel: 1015,
  Hello: 1016,
  Stretch: 1017,
  TrajectoryFollow: 1018,
  ContinuousGait: 1019,
  Content: 1020,
  Wallow: 1021,
  Dance1: 1022,
  Dance2: 1023,
  GetBodyHeight: 1024,
  GetFootRaiseHeight: 1025,
  GetSpeedLevel: 1026,
  SwitchJoystick: 1027,
  Pose: 1028,
  Scrape: 1029,
  FrontFlip: 1030,
  FrontJump: 1031,
  FrontPounce: 1032,
  WiggleHips: 1033,
  GetState: 1034,
  EconomicGait: 1035,
  FingerHeart: 1036,
  // MCF-specific IDs (2xxx) — used by newer firmware
  LeftFlip: 2041,
  BackFlip: 2043,
  HandStand: 2044,
  FreeWalk: 2045,
  FreeBound: 2046,
  FreeJump: 2047,
  FreeAvoid: 2048,
  CrossStep: 2051,
  LeadFollow: 2056,
  BackStand: 2050,   // Rear Stand — MCF firmware
  RageMode: 2059,    // Rage mode — MCF firmware
  // MCF IDs that differ from Normal
  StaticWalk: 1061,
  TrotRun: 1062,
  MCF_EconomicGait: 1063,
  // AI-only (1xxx, also work in MCF for some)
  WalkStair: 1049,
} as const;

export const DATA_CHANNEL_TYPE = {
  VALIDATION: 'validation',
  SUBSCRIBE: 'subscribe',
  UNSUBSCRIBE: 'unsubscribe',
  MSG: 'msg',
  REQUEST: 'req',
  RESPONSE: 'res',
  VID: 'vid',
  AUD: 'aud',
  ERR: 'err',
  ERRORS: 'errors',
  ADD_ERROR: 'add_error',
  RM_ERROR: 'rm_error',
  HEARTBEAT: 'heartbeat',
  RTC_INNER_REQ: 'rtc_inner_req',
  RTC_REPORT: 'rtc_report',
} as const;
