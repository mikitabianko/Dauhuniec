/** Full, unmodified publisher documentation. URLs checked against ST/Arm/FreeRTOS sources. */
export interface OfficialDocument {
  id: string;
  label: string;
  publisher: string;
  url: string;
  format: 'pdf' | 'web';
  family?: string;
}

const stManual = (family: string, id: string, resource: string): OfficialDocument => ({
  id, family, publisher: 'STMicroelectronics', format: 'pdf',
  label: `${family} HAL / LL · ${id}`,
  url: `https://www.st.com/resource/en/user_manual/${resource}.pdf`
});

export const halManuals: readonly OfficialDocument[] = [
  stManual('STM32F0', 'UM1785', 'dm00122015-description-of-stm32f0-hal-and-low-layer-drivers-stmicroelectronics'),
  stManual('STM32F1', 'UM1850', 'um1850-stm32cubef1-hal-driver-user-manual-stmicroelectronics'),
  stManual('STM32F2', 'UM1940', 'dm00223149-description-of-stm32f2-hal-and-low-layer-drivers-stmicroelectronics'),
  stManual('STM32F3', 'UM1786', 'dm00122016-description-of-stm32f3-hal-and-lowlayer-drivers-stmicroelectronics'),
  stManual('STM32F4', 'UM1725', 'um1725-description-of-stm32f4-hal-and-lowlayer-drivers-stmicroelectronics'),
  stManual('STM32F7', 'UM1905', 'dm00189702-description-of-stm32f7-haland-lowlayer-drivers-stmicroelectronics'),
  stManual('STM32G0', 'UM2319', 'um2319-description-of-stm32g0-hal-and-lowlayer-drivers-stmicroelectronics'),
  stManual('STM32G4', 'UM2570', 'dm00610707-description-of-stm32g4-hal-and-low-layer-drivers-stmicroelectronics'),
  stManual('STM32H5', 'UM3132', 'dm00948527'),
  stManual('STM32H7', 'UM2217', 'dm00392525'),
  stManual('STM32L0', 'UM1749', 'um1749-description-of-stm32l0-hal-and-low-layer-drivers-stmicroelectronics'),
  stManual('STM32L1', 'UM1816', 'dm00132099-description-of-stm32l1-hal-and-low-layer-drivers-stmicroelectronics'),
  stManual('STM32L4', 'UM1884', 'dm00173145'),
  stManual('STM32L5', 'UM2659', 'um2659-description-of-stm32l5-hal-and-lowlayer-drivers-stmicroelectronics'),
  stManual('STM32U5', 'UM2911', 'um2911-description-of-stm32u5-hal-and-lowlayer-driver-stmicroelectronics'),
  stManual('STM32WB', 'UM2442', 'dm00524025-description-of-stm32wb-hal-and-lowlayer-drivers-stmicroelectronics'),
  stManual('STM32WL', 'UM2642', 'um2642-description-of-stm32wl-hal-and-lowlayer-drivers-stmicroelectronics')
];

export const rtosDocuments: readonly OfficialDocument[] = [
  { id: 'freertos-api', label: 'FreeRTOS · Full documentation and API reference', publisher: 'FreeRTOS', format: 'web',
    url: 'https://www.freertos.org/Documentation/00-Overview' },
  { id: 'cmsis-rtos2', label: 'CMSIS-RTOS2 · Full API reference', publisher: 'Arm', format: 'web',
    url: 'https://arm-software.github.io/CMSIS_6/main/RTOS2/group__CMSIS__RTOS.html' },
  { id: 'cmsis-rtos1', label: 'CMSIS-RTOS v1 · Full API reference (legacy)', publisher: 'Arm', format: 'web',
    url: 'https://arm-software.github.io/CMSIS_5/latest/RTOS/html/index.html' },
  { id: 'UM1722', label: 'STM32Cube with RTOS · UM1722 (integration guide)', publisher: 'STMicroelectronics', format: 'pdf',
    url: 'https://www.st.com/resource/en/user_manual/um1722-developing-applications-on-stm32cube-with-rtos-stmicroelectronics.pdf' },
  { id: 'freertos-reference-v10', label: 'FreeRTOS · Reference manual V10.0.0 (legacy PDF)', publisher: 'FreeRTOS', format: 'pdf',
    url: 'https://www.freertos.org/media/2018/FreeRTOS_Reference_Manual_V10.0.0.pdf' }
];

/** Longest family prefixes first; never substitute a different family's manual. */
export function stm32Family(device?: string): string | undefined {
  const name = device?.trim().toUpperCase();
  if (!name) return;
  if (/^STM32H7[RS]/.test(name)) return 'STM32H7RS';
  return name.match(/^(STM32(?:WBA|WB0|WB|WLE|WL3|WL|C0|C5|F0|F1|F2|F3|F4|F7|G0|G4|G5|H5|H7|L0|L1|L4|L5|N6|U0|U3|U5))(?=[A-Z0-9]|$)/)?.[1]
    ?.replace(/^STM32WLE$/, 'STM32WL');
}

export function halManual(device?: string): OfficialDocument | undefined {
  const family = stm32Family(device);
  return halManuals.find(manual => manual.family === family);
}

export function firmwareDocumentation(device?: string): OfficialDocument | undefined {
  const family = stm32Family(device);
  if (!family) return;
  return { id: `${family}-package`, label: `${family} · Official firmware package documentation`, publisher: 'STMicroelectronics', format: 'web',
    url: `https://www.st.com/en/embedded-software/${family.toLowerCase().replace('stm32', 'stm32cube')}.html#documentation` };
}
