import { createContext, useContext } from "react";
import { DEFAULT_HOTELS } from "../data/hotels";

/* الفندق المفتوح دلوقتي (كل شاشة بتشتغل على فندق واحد) + قايمة كل فنادق الجروب. */
export const HotelContext = createContext({ hotels: DEFAULT_HOTELS, hotel: DEFAULT_HOTELS[0], hotelId: 1 });
export const useHotel = () => useContext(HotelContext);
