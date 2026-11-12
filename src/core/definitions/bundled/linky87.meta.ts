/**
 * Presentation metadata for the ELECFOX Linky87. The Win/Mac switch on the
 * board selects layer 0 or 1; holding Fn adds layer 2 or 3.
 */
import type {BoardMetaSource} from '../board-meta.ts';

export const linky87Meta: BoardMetaSource = {
  layers: [
    {name: 'Windows', short: 'Win', os: 'windows', fn: false, pair: 1},
    {name: 'Mac', short: 'Mac', os: 'mac', fn: false, pair: 0},
    {name: 'Windows Fn', short: 'Win Fn', os: 'windows', fn: true, base: 0, pair: 3},
    {name: 'Mac Fn', short: 'Mac Fn', os: 'mac', fn: true, base: 1, pair: 2},
  ],
  zones: [
    {zoneLabel: 'Backlight', name: 'Backlight', description: 'Under every key', part: 'backlight'},
    {zoneLabel: 'logo', name: 'Logo', description: 'The badge above the arrows', part: 'logo'},
    {zoneLabel: 'side', name: 'Side lights', description: 'Strips on both edges', part: 'side'},
  ],
  keyNotes: [
    {
      layer: 0,
      row: 5,
      col: 10,
      legend: 'Fn',
      text: 'The keyboard reports this Fn key as "hold Windows". Its own firmware probably handles Fn, so it is best left as it is.',
    },
  ],
  customKeys: {
    '2.4G': {name: '2.4 GHz wireless', legend: '2.4G'},
    BLE1: {name: 'Bluetooth 1', legend: 'BT 1'},
    BLE2: {name: 'Bluetooth 2', legend: 'BT 2'},
    BLE3: {name: 'Bluetooth 3', legend: 'BT 3'},
    USB: {name: 'USB cable', legend: 'USB'},
    BAT: {name: 'Show battery level', legend: 'Battery'},
    WLO: {name: 'Lock the Windows key', legend: 'Win\nlock'},
    SIX_N: {name: 'Switch 6-key and all-key rollover', legend: '6KRO'},
    TEST: {name: 'Light test', legend: 'Test'},
    KbPrSlp: {name: 'Sleep timer 1', legend: 'Sleep 1'},
    KbdSecS: {name: 'Sleep timer 2', legend: 'Sleep 2'},
    KEY_DEB: {name: 'Change debounce time', legend: 'Debounce'},
    RTOG: {name: 'Backlight on or off', legend: 'Lights\non/off'},
    LG_TOG: {name: 'Logo light on or off', legend: 'Logo\non/off'},
    LG_MO: {name: 'Next logo effect', legend: 'Logo\neffect'},
    LG_RM: {name: 'Previous logo effect', legend: 'Logo\neffect −'},
    LG_HUI: {name: 'Logo colour forward', legend: 'Logo\nhue +'},
    LG_HUD: {name: 'Logo colour back', legend: 'Logo\nhue −'},
    LG_SAI: {name: 'Logo colour stronger', legend: 'Logo\nsat +'},
    LG_SAD: {name: 'Logo colour paler', legend: 'Logo\nsat −'},
    LG_VAI: {name: 'Logo brighter', legend: 'Logo\nbright +'},
    LG_VAD: {name: 'Logo dimmer', legend: 'Logo\nbright −'},
    LG_SPI: {name: 'Logo effect faster', legend: 'Logo\nspeed +'},
    LG_SPD: {name: 'Logo effect slower', legend: 'Logo\nspeed −'},
    SI_TOG: {name: 'Side lights on or off', legend: 'Sides\non/off'},
    SI_MO: {name: 'Next side effect', legend: 'Sides\neffect'},
    SI_RM: {name: 'Previous side effect', legend: 'Sides\neffect −'},
    SI_HUI: {name: 'Side colour forward', legend: 'Sides\nhue +'},
    SI_HUD: {name: 'Side colour back', legend: 'Sides\nhue −'},
    SI_SAI: {name: 'Side colour stronger', legend: 'Sides\nsat +'},
    SI_SAD: {name: 'Side colour paler', legend: 'Sides\nsat −'},
    SI_VAI: {name: 'Side lights brighter', legend: 'Sides\nbright +'},
    SI_VAD: {name: 'Side lights dimmer', legend: 'Sides\nbright −'},
    SI_SPI: {name: 'Side effect faster', legend: 'Sides\nspeed +'},
    SI_SPD: {name: 'Side effect slower', legend: 'Sides\nspeed −'},
  },
  look: {logoText: 'LINKY87'},
};
