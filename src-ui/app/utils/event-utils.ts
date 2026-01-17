export const isHolidaysEventActive = () => {
  const now = new Date();
  return now.getMonth() === 11 && now.getDate() >= 1;
};
