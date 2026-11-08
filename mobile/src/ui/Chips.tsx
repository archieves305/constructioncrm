import { Pressable, Text, View } from "react-native";
import { s } from "./components";
import { TOUCH, useTheme } from "./theme";

type Choice<T> = { value: T; label: string };

export function Chips<T extends string>({ value, options, onChange, label }: { value: T; options: Choice<T>[]; onChange: (v: T) => void; label: string }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Text style={[s.label, { color: t.muted }]}>{label}</Text>
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }} accessibilityRole="radiogroup">
        {options.map((o) => {
          const on = o.value === value;
          return (
            <Pressable
              key={o.value}
              accessibilityRole="radio"
              accessibilityState={{ selected: on }}
              onPress={() => onChange(o.value)}
              style={{
                minHeight: TOUCH,
                paddingHorizontal: 16,
                borderRadius: 24,
                justifyContent: "center",
                borderWidth: 1,
                borderColor: on ? t.brand : t.border,
                backgroundColor: on ? t.brandSoft : t.card,
              }}
            >
              <Text style={{ color: on ? t.brand : t.text, fontWeight: on ? "700" : "500", fontSize: 15 }}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

